var Crawler = require( "crawler" );
var parse_url = require( "url" );
var ParseHref = require( "./lib/parse-href" );
var es = require( "elasticsearch" );
var util = require( "util" );

require( "dotenv" ).config();

var wsu_web_crawler = {
	scan_urls: [],     // Tracks the list of URLs to be scanned.
	scanned_urls: [],  // Tracks the list of URLs scanned.
	store_urls: [],    // Tracks the list of URLs to be stored.
	stored_urls: 0,    // Tracks the number of URLs stored.
	queue_lock: false  // Used to lock the crawler queue.
};

wsu_web_crawler.scan_urls = process.env.START_URLS.split( "," );
wsu_web_crawler.store_urls = process.env.START_URLS.split( "," );

var parse_href = new ParseHref( {

	// These top level domains are allowed to be scanned by the crawler.
	allowed_domains: process.env.ROOT_DOMAINS.split( "," ),

	// These subdomains are flagged to not be scanned.
	flagged_domains: process.env.SKIP_DOMAINS.split( "," ),

	// These file extensions are flagged to not be scanned.
	flagged_extensions: [ "jpg", "jpeg", "gif", "png" ]
} );

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

// Prefills a list of URLs to scan based on those already with an initial set of
// data stored in Elasticsearch.
function prefillURLs() {
	var elastic = elasticClient();

	elastic.search( {
		index: process.env.ES_URL_INDEX,
		type: "url",
		body: {
			size: 100,
			query: {
				bool: {
					must_not: [
						{
							exists: {
								field: "status_code"
							}
						}
					]
				}
			}
		}
	} ).then( function( response ) {
		for ( var j = 0, y = response.hits.hits.length; j < y; j++ ) {
			wsu_web_crawler.scan_urls.push( response.hits.hits[ j ]._source.url );
		}
		util.log( "Prefill: " + wsu_web_crawler.scan_urls.length + " URLs to scan" );
	} ).catch( function( error ) {
		util.log( "Error (prefillURLs): " + error );
	} );

	elastic = null;
}

// Stores a list of URLs in Elasticsearch with a bulk request.
function storeURLs( response ) {
	return new Promise( function( resolve, reject ) {
		var bulk_body = response.body;
		var urls = response.urls;

		var elastic = elasticClient();
		elastic.bulk( { body: bulk_body } )
			.then( function( response ) {
				wsu_web_crawler.stored_urls = wsu_web_crawler.stored_urls + urls.length;
				resolve();
			} )
			.catch( function( error ) {
				// @todo should some URLs be added back to store_urls?
				reject( "Bulk URL storage not successful: " + error.message );
			} );
	} );
}

// Queues all waiting URLs for scan.
function scanURLs() {
	if ( false === wsu_web_crawler.queue_lock ) {
		var queue_urls = wsu_web_crawler.scan_urls.slice( 0, 101 );
		wsu_web_crawler.scan_urls = wsu_web_crawler.scan_urls.slice( 101 );

		util.log( "Queue: Add " + queue_urls.length + " URLs to queue of " + c.queueSize + " from backlog of " + wsu_web_crawler.scan_urls.length );
		c.queue( queue_urls );
	}

	if ( false === wsu_web_crawler.queue_lock && 100 < c.queueSize ) {
		util.log( "Queue: Temporarily lock crawler queue" );
		wsu_web_crawler.queue_lock = true;
	}
}

/**
 * Updates a URLs record with the results of a URL scan.
 *
 * @param url {string}
 * @param data {object}
 */
function updateURLData( url, data ) {
	var elastic = elasticClient();
	elastic.search( {
		index: process.env.ES_URL_INDEX,
		type: "url",
		body: {
			size: 1,
			query: {
				bool: {
					must: {
						term: {
							url: url
						}
					}
				}
			}
		}
	} ).then( function( response ) {
		var d = new Date();

		if ( 0 === response.hits.hits.length ) {
			wsu_web_crawler.scan_urls.push( url ); // Requeue the URL to be scanned.
			util.log( "Error: " + url + " No record found to update" );
		} else {
			var elastic = elasticClient();
			elastic.update( {
				index: process.env.ES_URL_INDEX,
				type: "url",
				id: response.hits.hits[ 0 ]._id,
				body: {
					doc: {
						identity: data.identity_version,
						analytics: data.global_analytics,
						status_code: data.status_code,
						redirect_url: data.redirect_url,
						content: data.content,
						last_scan: d.getTime(),
						anchors: data.anchors
					}
				}
			} )
			.then( function() {
				wsu_web_crawler.scanned_urls.push( url );
				util.log( "Updated: " + url );
			} )
			.catch( function( error ) {
				wsu_web_crawler.scan_urls.push(url);
				util.log("Error (updateURLData 2): " + url + " " + error.message );
			} );
		}
	} ).catch( function( error ) {
		util.log( "Error (updateURLData 1): " + error.message )
	} );
}

// Parse a crawl result for anchor elements and determine if individual href
// attributes should be marked to scan or to store based on existing data.
function handleCrawlResult( res ) {
	return new Promise( function( resolve, reject ) {
		var reject_message = "";

		var url_update = {
			identity_version: "unknown",
			global_analytics: "unknown",
			status_code: res.statusCode,
			redirect_url: "",
			anchors: []
		};

		var file_extension = res.request.uri.pathname.split( "." ).pop().toLowerCase();

		// Watch for URLs that do not respond as a 200 OK.
		if ( 200 !== res.statusCode ) {

			// If a 301 or 302, a location for the new URL will be available.
			if ( "undefined" !== typeof res.headers.location ) {
				var url = parse_href.get_url( res.headers.location, res.options.uri );

				// Mark un-scanned URLS to be scanned.
				if ( url && url !== res.options.uri && -1 >= wsu_web_crawler.scanned_urls.indexOf( url ) && -1 >= wsu_web_crawler.scan_urls.indexOf( url ) ) {
					wsu_web_crawler.scan_urls.push( url );
				}

				// Mark un-stored URLs to be stored.
				if ( url && -1 >= wsu_web_crawler.store_urls.indexOf( url ) ) {
					wsu_web_crawler.store_urls.push( url );
				}

				url_update.redirect_url = url;
			} else {

				// This is likely a 404, 403, 500, or other error code.
				reject_message = res.statusCode + " response code";
			}
		} else if ( "pdf" === file_extension ) {
			url_update.status_code = 900;
		} else if ( "doc" === file_extension || "docx" === file_extension ) {
			url_update.status_code = 901;
		} else if ( "xls" === file_extension || "xlsx" === file_extension || "xlsm" === file_extension || "xlsb" === file_extension ) {
			url_update.status_code = 902;
		} else if ( "ppt" === file_extension || "pptx" === file_extension || "pptm" === file_extension ) {
			url_update.status_code = 903;
		} else if ( "zip" === file_extension ) {
			url_update.status_code = 904;
		} else if ( /http-equiv="refresh"/i.test( res.body ) ) {
			url_update.status_code = 301;

			// PhantomJS has problems processing pages that auto redirect.
			reject_message = "Page body contains http-equiv refresh";
		} else if ( /top.location.href/i.test( res.body ) || /window.location.href/i.test( res.body ) ) {
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

					// If a URL has not been scanned and is not slated to be scanned,
					// mark it to be scanned.
					if ( url !== res.options.uri && -1 >= wsu_web_crawler.scanned_urls.indexOf( url ) && -1 >= wsu_web_crawler.scan_urls.indexOf( url ) ) {
						wsu_web_crawler.scan_urls.push( url );
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

			// Store the main content as plain text for search purposes. If a <main> element
			// does not exist, try a container with an ID of main. Fallback to the full body
			// content if neither exist.
			if ( 0 !== $( "main" ).length ) {
				url_update.content = $( "main" ).text().replace( /\s+/g, " " ).trim();
			} else if ( 0 !== $( "#main" ) ) {
				url_update.content = $( "#main" ).text().replace( /\s+/g, " " ).trim();
			} else if ( 0 !== $( "body" ).length ) {
				url_update.content = $( "body" ).text().replace( /\s+/g, " " ).trim();
			} else {
				url_update.content = "";
			}
		}

		// Update the URL's record with the results of this scan.
		updateURLData( res.options.uri, url_update );

		if ( 0 === wsu_web_crawler.store_urls.length ) {
			reject( "Result: No new unique URLs." );
		} else if ( "" !== reject_message ) {
			reject( reject_message );
		} else {
			resolve();
		}
	} );
}

// Checks a list of URLs against those currently stored in Elasticsearch
// so that storage of duplicate URLs is avoided.
function checkURLStore() {
	return new Promise( function( resolve, reject ) {
		var local_store_urls = wsu_web_crawler.store_urls;
		wsu_web_crawler.store_urls = [];

		if ( 0 === local_store_urls.length ) {
			reject( "Bulk Result: No URLs passed to attempt lookup" );
		}

		var elastic = elasticClient();
		elastic.search( {
			index: process.env.ES_URL_INDEX,
			type: "url",
			body: {
				size: local_store_urls.length,
				query: {
					bool: {
						filter: {
							terms: {
								url: local_store_urls
							}
						}
					}
				}
			}
		} ).then( function( resp ) {
			var found_urls = local_store_urls.length;
			var local_urls = local_store_urls;
			local_store_urls = null;
			var indexed_urls = 0;

			if ( 0 !== resp.hits.hits.length ) {
				indexed_urls = resp.hits.total;

				for ( var j = 0, y = resp.hits.hits.length; j < y; j++ ) {
					var index = local_urls.indexOf( resp.hits.hits[ j ]._source.url );
					if ( -1 < index ) {
						local_urls.splice( index, 1 );
					}
				}
			}

			var bulk_body = [];

			for ( var i = 0, x = found_urls; i < x; i++ ) {
				if ( "undefined" === typeof local_urls[ i ] ) {
					continue;
				}

				var url = parse_url.parse( local_urls[ i ] );

				bulk_body.push( { index: { _index: process.env.ES_URL_INDEX, _type: "url" } } );
				bulk_body.push( { url: local_urls[ i ], domain: url.hostname } );
			}

			if ( 0 !== bulk_body.length ) {
				util.log( "Bulk Result: Stored " + local_urls.length + " new URLs" );
				resolve( { body: bulk_body, urls: local_urls } );
			} else {
				reject( "Bulk Result: No new URLs found" );
			}
		} ).catch( function( err ) {
			reject( "Error (checkURLStore): " + err.message );
		} );
	} );
}

// Outputs a common set of data after individual crawls and, if needed,
// queues up the next request.
function finishResult() {
	util.log( "Status: " + wsu_web_crawler.scanned_urls.length + " scanned, " + wsu_web_crawler.stored_urls + " stored, " + c.queueSize + " queued");

	// If the queue is locked and the queue size is 0, reset the crawler.
	if ( true === wsu_web_crawler.queue_lock && 0 < wsu_web_crawler.scan_urls.length && 0 === c.queueSize ) {
		util.log( "Queue: Reset queue object" );
		c = '';
		c = getCrawler();
		wsu_web_crawler.queue_lock = false;
	}

	// If the queue is not locked, continue scanning.
	if ( false === wsu_web_crawler.queue_lock ) {
		scanURLs();
	}
}

/**
 * Handle crawl callbacks from node-crawler.
 *
 * @param {string} error
 * @param {object} result
 * @param {method} done
 */
function handleCrawl( error, result, done ) {
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
	if ( 'error' === type || 'critical' === type ) {
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
		rateLimit: 100,
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
		}
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

// Prefill URLs to scan from those stored in the index.
prefillURLs();

// Start scanning URLs.
scanURLs();

// Handle the bulk storage of found URLs in another thread.
setTimeout( storeFoundURLs, 2000 );
