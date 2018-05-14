var Crawler = require( "crawler" );
var parse_url = require( "url" );
var ParseHref = require( "./lib/parse-href" );
var es = require( "elasticsearch" );
var util = require( "util" );

try {
	var parse_config = require( "./parse-config.json" );
} catch ( error ) {
	util.log( error );
	util.log( "Error loading parse_config.json. Starting crawl with no exclusions." );
	var parse_config = {
		allowed_root_domains: [],
		flagged_domains: [],
		flagged_extensions: [],
	};
}

require( "dotenv" ).config();

var wsu_web_crawler = {
	lock_key: 0,
	locker_locked: false,
	url_queue: {},     // Maintain a list of URLs in queue.
	store_urls: [],    // List of URLs to be stored.
	scanned_verify: 0, // Number of URLs scanned.
	stored_urls: 0,    // Number of URLs stored.
	locked_urls: 0     // Total number of URLs locked by this crawler instance.
};

wsu_web_crawler.lock_key = process.env.LOCK_KEY;

var parse_href = new ParseHref( parse_config );

/**
 * Retrieve a new instance of a configured Elasticsearch client.
 *
 * This allows us to destroy the client after each use and prevent
 * memory leaks.
 *
 * @returns {es.Client}
 */
function elasticClient() {
	return new es.Client( {
		host: process.env.ES_HOST,
		log: "error"
	} );
}

function getElasticClient() {
	if ( null === wsu_web_crawler.es || "undefined" === typeof wsu_web_crawler.es ) {
		wsu_web_crawler.es = elasticClient();
	}

	return wsu_web_crawler.es;
}

/**
 * Lock the next URL to be scanned with the data collector.
 *
 * Looks for URLs in this order:
 *
 * - Flagged with a priority higher than 0.
 * - Has never been scanned.
 * - Least recently scanned.
 *
 * @returns {*}
 */
function lockURL() {

	// Do not lock any URLs when the lock limit has been reached.
	if ( wsu_web_crawler.locker_locked === true ) {
		return;
	}

	var elastic = getElasticClient();

	// Look for any URLs that have been prioritized.
	return elastic.updateByQuery( {
		index: process.env.ES_URL_INDEX,
		type: "url",
		body: {
			size: 2,
			query: {
				range: {
					search_scan_priority: {
						gte: 1,
						lte: 999
					}
				}
			},
			sort: [
				{
					search_scan_priority: {
						order: "asc"
					}
				}
			],
			script: {
				inline: "ctx._source.search_scan_priority = " + wsu_web_crawler.lock_key
			}
		}
	} ).then( function( response ) {
		if ( 1 <= response.updated ) {
			wsu_web_crawler.locked_urls += response.updated;
			throw response.updated;
		}

		return elastic.updateByQuery( {
			index: process.env.ES_URL_INDEX,
			type: "url",
			body: {
				size: 2,
				query: {
					bool: {
						must_not: [
							{ exists: { field: "last_search_scan" } },
							{ exists: { field: "search_scan_priority" } }
						]
					}
				},
				script: {
					inline: "ctx._source.search_scan_priority = " + wsu_web_crawler.lock_key
				}
			}
		} ).then( function( response ) {
			if ( 1 <= response.updated ) {
				wsu_web_crawler.locked_urls += response.updated;
				throw response.updated;
			}

			return elastic.updateByQuery( {
				index: process.env.ES_URL_INDEX,
				type: "url",
				body: {
					size: 2,
					query: {
						bool: {
							must_not: [
								{ exists: { field: "search_scan_priority" } }
							],
							must: [
								{ exists: { field: "last_search_scan" } },
								{
									range: {
										last_search_scan: {
											"lte": "now-1d/d"
										}
									}
								}
							]
						}
					},
					sort: [
						{
							last_search_scan: {
								order: "asc"
							}
						}
					],
					script: {
						inline: "ctx._source.search_scan_priority = " + wsu_web_crawler.lock_key
					}
				}
			} ).then( function( response ) {
				if ( 1 <= response.updated ) {
					wsu_web_crawler.locked_urls += response.updated;
					throw response.updated;
				}

				return 0;
			} );
		} );
	} ).then( function( response ) {
		throw response;
	} ).catch( function( response ) {
		return response;
	} );
}

/**
 * Queue any locked URLs for crawl.
 *
 * @returns {*}
 */
function queueLockedURLs() {
	var elastic = getElasticClient();

	return elastic.search( {
		index: process.env.ES_URL_INDEX,
		type: "url",
		body: {
			size: 15,
			query: {
				match: {
					"search_scan_priority": wsu_web_crawler.lock_key
				}
			}
		}
	} ).then( function( response ) {
		if ( response.hits.total >= 14 ) {
			wsu_web_crawler.locker_locked = true;
		} else {
			wsu_web_crawler.locker_locked = false;
		}

		for ( var j = 0, y = response.hits.hits.length; j < y; j++ ) {
			if ( response.hits.hits[ j ]._source.url in wsu_web_crawler.url_queue ) {
				wsu_web_crawler.url_queue[ response.hits.hits[ j ]._source.url ].count++;

				if ( 30 <= wsu_web_crawler.url_queue[ response.hits.hits[ j ]._source.url ].count ) {
					markURLUnresponsive( response.hits.hits[ j ]._source.url );
				}
				continue;
			}

			wsu_web_crawler.url_queue[ response.hits.hits[ j ]._source.url ] = {
				id: response.hits.hits[ j ]._id,
				count: 1
			};
			c.queue( response.hits.hits[ j ]._source.url );
		}

		if ( 1 <= response.hits.hits.length ) {
			util.log( "Queued: " + response.hits.hits.length + " URLs for ID " + wsu_web_crawler.lock_key );
			return true;
		}

		return true;
	} ).catch( function( error ) {
		util.log( "Error: " + error );
		throw 0;
	} );
}

function markURLUnresponsive( url ) {
	if ( "undefined" === typeof wsu_web_crawler.url_queue[ url ] ) {
		util.log( "Error updating "  + url + ", ID " + wsu_web_crawler.url_queue[ url ].id );
		return;
	}

	var elastic = elasticClient();
	var d = new Date();
	const url_id = encodeURIComponent( url );

	elastic.update( {
		index: process.env.ES_URL_INDEX,
		type: "url",
		id: url_id,
		body: {
			doc: {
				identity: "unknown",
				analytics: "unknown",
				status_code: 800,
				redirect_url: null,
				last_search_scan: d.getTime(),
				search_scan_priority: null,
				a11y_scan_priority: null,
				anchor_scan_priority: null
			}
		}
	} )
	.then( function() {
		wsu_web_crawler.scanned_verify++;
		delete wsu_web_crawler.url_queue[ url ];
		util.log( "URL marked unresponsive: " + url );
	} )
	.catch( function( error ) {

		// @todo what do do with a failed scan?
		util.log( "Error (updateURLData 2): " + url + " " + error.message );
	} );
}

/**
 * Store a bulk list of newly found URLs in Elasticsearch.
 *
 * @param {object} response
 * @returns {Promise}
 */
function storeURLs( response ) {
	return new Promise( function( resolve, reject ) {
		const bulk_body = response.body;
		const elastic = elasticClient();

		elastic.bulk( { body: bulk_body } )
			.then( function() {
				resolve();
			} )
			.catch( function( error ) {

				// @todo should some URLs be added back to store_urls?
				reject( "Bulk URL storage not successful: " + error.message );
			} );
	} );
}

/**
 * Update a URL record with the results of a crawl.
 *
 * @param {string} url
 * @param {object} data
 */
function updateURLData( url, data ) {
	if ( "undefined" === typeof wsu_web_crawler.url_queue[ url ] ) {
		util.log( "Error updating "  + url + ", ID " + wsu_web_crawler.url_queue[ url ].id );
		return;
	}

	const elastic = elasticClient();
	const d = new Date();
	const url_id = encodeURIComponent( url );

	elastic.update( {
		index: process.env.ES_URL_INDEX,
		type: "url",
		id: url_id,
		body: {
			doc: {
				identity: data.identity_version,
				analytics: data.global_analytics,
				status_code: data.status_code,
				redirect_url: data.redirect_url,
				title: data.title,
				image: data.image,
				description: data.description,
				content: data.content,
				last_search_scan: d.getTime(),
				search_scan_priority: null,
				a11y_scan_priority: 50,
				anchor_scan_priority: 50,
				anchors: data.anchors
			}
		}
	} )
	.then( function() {
		wsu_web_crawler.scanned_verify++;
		delete wsu_web_crawler.url_queue[ url ];
		util.log( "Updated: " + url );
	} )
	.catch( function( error ) {

		// @todo what do do with a failed scan?
		util.log( "Error (updateURLData 2): " + url + " " + error.message );
	} );
}

/**
 * Parse a crawl result and determine what information about the crawl
 * should be stored for the URL in Elasticsearch.
 *
 * @param {object} res
 * @returns {Promise}
 */
function handleCrawlResult( res ) {
	return new Promise( function( resolve, reject ) {
		var reject_message = "";

		var url_update = {
			identity_version: "unknown",
			global_analytics: "unknown",
			status_code: res.statusCode,
			redirect_url: "",
			title: "",
			image: "",
			description: "",
			content: "",
			anchors: []
		};

		var file_extension = res.request.uri.pathname.split( "." ).pop().toLowerCase().replace( /\/$/, "" );

		let content_type = "text/html";

		if ( "undefined" !== typeof( res.headers[ "content-type" ] ) ) {
			content_type = res.headers[ "content-type" ].split( ";" ).shift().toLowerCase();
		}

		// Watch for URLs that do not respond as a 200 OK.
		if ( 200 !== res.statusCode ) {

			// If a 301 or 302, a location for the new URL will be available.
			if ( "undefined" !== typeof res.headers.location ) {
				var url = parse_href.get_url( res.headers.location, res.options.uri );

				// Mark found URLs to be stored.
				if ( url && -1 >= wsu_web_crawler.store_urls.indexOf( url ) ) {
					wsu_web_crawler.store_urls.push( url );
				}

				url_update.redirect_url = url;
			} else {

				// This is likely a 404, 403, 500, or other error code.
				reject_message = res.statusCode + " response code";
			}
		} else if ( "pdf" === file_extension || "application/pdf" === content_type ) {
			url_update.status_code = 900;
		} else if ( "doc" === file_extension || "docx" === file_extension ) {
			url_update.status_code = 901;
		} else if ( "xls" === file_extension || "xlsx" === file_extension || "xlsm" === file_extension || "xlsb" === file_extension || "xlt" === file_extension || "csv" === file_extension ) {
			url_update.status_code = 902;
		} else if ( "ppt" === file_extension || "pptx" === file_extension || "pptm" === file_extension || "pps" === file_extension || "ppsx" === file_extension ) {
			url_update.status_code = 903;
		} else if ( "mp4" === file_extension || "mov" === file_extension ) {
			url_update.status_code = 904;
		} else if ( "mp3" === file_extension || "ram" === file_extension ) {
			url_update.status_code = 905;
		} else if ( "swf" === file_extension ) {
			url_update.status_code = 906;
		} else if ( "txt" === file_extension ) {
			url_update.status_code = 907;
		} else if ( "eps" === file_extension ) {
			url_update.status_code = 908;
		} else if ( "ics" === file_extension || "text/calendar" === content_type ) {
			url_update.status_code = 909;
		} else if ( "tex" === file_extension || "sty" === file_extension ) {
			url_update.status_code = 910;
		} else if ( /http-equiv="refresh"/i.test( res.body ) ) {
			url_update.status_code = 301;

			// PhantomJS has problems processing pages that auto redirect.
			reject_message = "Page body contains http-equiv refresh";
		} else if ( /(top|window)\.location\.href[\s=]/i.test( res.body ) ) {

			// If window.location.href or top.location.href appear in a way consistent
			// with JS based page redirects, then mark accordingly.
			url_update.status_code = 301;

			// PhantomJS has problems processing pages that auto redirect.
			reject_message = "Page body appears to contain refresh script";
		} else if ( "undefined" === typeof res.$ ) {
			url_update.status_code = 999;

			reject_message = "Non HTML URL " + res.options.uri;
		} else {
			var $ = res.$;

			// Attempt to determine what identity a site is using.
			if ( /spine.min.js/i.test( res.body ) ) {
				url_update.identity_version = "spine";
			} else if ( /spine.js/i.test( res.body ) ) {
				url_update.identity_version = "spine";
			} else if ( /identifierv2.js/i.test( res.body ) ) {
				url_update.identity_version = "identifierv2";
			} else {
				url_update.identity_version = "other";
			}

			// Check if global analytics are likely in use.
			if ( /wsu_analytics/i.test( res.body ) ) {
				url_update.global_analytics = "enabled";
			}

			// Check if enhanced global analytics via GTM are in use.
			if ( /GTM-K5CHVG/i.test( res.body ) ) {
				url_update.global_analytics = "tag_manager";
			}

			$( "a" ).each( function( index, value ) {
				if ( undefined !== value.attribs.href && "#" !== value.attribs.href ) {
					var url = parse_href.get_url( value.attribs.href, res.options.uri );

					if ( false === url ) {
						return;
					}

					// If a URL is not slated to be stored, mark it to be stored.
					if ( -1 >= wsu_web_crawler.store_urls.indexOf( url ) ) {
						wsu_web_crawler.store_urls.push( url );
					}

					// Capture a list of unique anchors found at this URL.
					if ( -1 >= url_update.anchors.indexOf( url ) ) {
						url_update.anchors.push( url );
					}
				}
			} );

			var og_title = $( "meta[property='og:title']" );
			var title = $( "title" );

			if ( 0 !== og_title.length && 0 !== og_title.attr( "content" ).length ) {
				url_update.title = og_title.attr( "content" );
			} else if ( 0 !== title.length ) {
				url_update.title = title.text();
			}

			var image = $( "meta[property='og:image']" );

			if ( 0 !== image.length && 0 !== image.attr( "content" ).length ) {
				url_update.image = image.attr( "content" );
			}

			var og_description = $( "meta[property='og:description']" );
			var description = $( "meta[name='description']" );

			if ( 0 !== og_description.length && 0 !== og_description.attr( "content" ).length ) {
				url_update.description = og_description.attr( "content" );
			} else if ( 0 !== description.length && 0 !== description.attr( "content" ).length ) {
				url_update.description = description.attr( "content" );
			}

			// Store the main content as plain text for search purposes. If a <main> element
			// does not exist, try a container with an ID of main. Fallback to the full body
			// content if neither exist.
			var modern_main = $( "main" );
			var id_main = $( "#main" );
			var body_main = $( "body" );

			if ( 0 !== modern_main.length ) {
				url_update.content = modern_main.text().replace( /\s+/g, " " ).trim();
			} else if ( 0 !== id_main.length ) {
				url_update.content = id_main.text().replace( /\s+/g, " " ).trim();
			} else if ( 0 !== body_main.length ) {
				url_update.content = body_main.text().replace( /\s+/g, " " ).trim();
			}
		}

		// Update the URL's record with the results of this scan.
		updateURLData( res.options.uri, url_update );

		if ( 0 === wsu_web_crawler.store_urls.length ) {
			reject( "Result: No new unique URLs." );
		} else if ( "" !== reject_message ) {
			reject( "Error (handleCrawlResult): " + reject_message );
		} else {
			resolve();
		}
	} );
}

/**
 * Check a bulk list of URLs against those already stored in Elasticsearch
 * and generate the list of URLs that should be stored as new.
 *
 * @returns {Promise}
 */
function checkURLStore() {
	return new Promise( function( resolve, reject ) {
		const local_store_urls = wsu_web_crawler.store_urls;

		// Reset the global container for URLs to be stored while
		// we process the data that is now local to this method.
		wsu_web_crawler.store_urls = [];

		if ( 0 === local_store_urls.length ) {
			reject( "Bulk Result: No URLs passed to attempt lookup" );
		}

		let bulk_body = [];

		for ( var i = 0, x = local_store_urls.length; i < x; i++ ) {
			if ( "undefined" === typeof local_store_urls[ i ] ) {
				continue;
			}

			const url = parse_url.parse( local_store_urls[ i ] );
			const id = encodeURIComponent( local_store_urls[ i ] );

			bulk_body.push( { index: { _index: process.env.ES_URL_INDEX, _type: "url", _id: id } } );
			bulk_body.push( { "url": local_store_urls[ i ], domain: url.hostname } );
		}

		if ( 0 !== bulk_body.length ) {
			util.log( "Bulk Result: Sending " + local_store_urls.length + " URLs to ElasticSearch" );
			resolve( { body: bulk_body, urls: local_store_urls } );
		} else {
			reject( "Bulk Result: No URLs found to send to ElasticSearch" );
		}
	} );
}

/**
 * Log the completion of individual queues.
 */
function finishResult() {
	util.log( "Status: " + wsu_web_crawler.scanned_verify + " scanned, " + wsu_web_crawler.locked_urls + " locked, " + wsu_web_crawler.store_urls.length + " to store" );
}

/**
 * Handle crawl callbacks from node-crawler.
 *
 * @param {string} error
 * @param {object} result
 * @param {method} done
 */
function handleCrawl( error, result, done ) {
	c.options.start_queue_size--;

	if ( error ) {
		finishResult();
	} else {
		handleCrawlResult( result )
			.then( finishResult )
			.catch( function( error ) {
				util.log( "Error (handleCrawl): " + error );
				finishResult();
			} );
	}
	done();
}

/**
 * Handle error messages generated by node-crawler.
 *
 * This is a custom log handler that is passed to the new
 * Crawler instance.
 *
 * @param {string} type
 * @param {string} message
 */
function handleCrawlLog( type, message ) {
	if ( "error" === type || "critical" === type ) {
		util.log( "Error (Node Crawler): " + message );
	}
}

/**
 * Retrieve a new instance of the Crawler from node-crawler.
 *
 * This allows us to handle a limited number of crawls through a Crawler
 * instance before freeing up any memory used by those processes.
 *
 * @returns {Crawler}
 */
function getCrawler() {
	return new Crawler( {
		rateLimit: 200,
		maxConnections: 10,
		maxRedirects: 0,
		followRedirect: false,
		retries: 0,
		retryTimeout: 1000,
		timeout: 4000,
		userAgent: "WSU Web Crawler: web.wsu.edu/crawler/",
		callback: handleCrawl,
		logger: {
			log: handleCrawlLog
		},
		start_queue_size: 0
	} );
}

/**
 * Process a list of URLs to be sent in bulk to the Elasticsearch
 * index. Repeat this process every 2 seconds.
 */
function storeFoundURLs() {
	checkURLStore()
		.then( storeURLs )
		.then( function() { setTimeout( storeFoundURLs, 2000 ); } )
		.catch( function( error ) {
			util.log( error );
			setTimeout( storeFoundURLs, 2000 );
		} );
}

var c = getCrawler();

// Handle the bulk storage of found URLs in another thread.
setTimeout( storeFoundURLs, 2000 );
setInterval( lockURL, 1000 );
setInterval( queueLockedURLs, 1500 );
