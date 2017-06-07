var Crawler = require( "crawler" );
var parse_url = require( "url" );
var ParseHref = require( "./lib/parse-href" );
var es = require( "elasticsearch" );
var util = require( "util" );

require( "dotenv" ).config();

// Tracks the list of URLs to be scanned.
var scan_urls = process.env.START_URLS.split( "," );

// Tracks the list of URLs scanned.
var scanned_urls = [];

// Tracks the list of URLs to be stored.
var store_urls = process.env.START_URLS.split( "," );

// Tracks the list of URLs stored.
var stored_urls = [];

var parse_href = new ParseHref( {

	// These top level domains are allowed to be scanned by the crawler.
	allowed_domains: process.env.ROOT_DOMAINS.split( "," ),

	// These subdomains are flagged to not be scanned.
	flagged_domains: process.env.SKIP_DOMAINS.split( "," ),

	// These file extensions are flagged to not be scanned.
	flagged_extensions: [ "jpg", "jpeg", "gif", "xls", "doc", "docx", "png" ]
} );

var elastic = new es.Client( {
	host: process.env.ES_HOST,
	log: "error"
} );

// Prefills a list of URLs to scan based on those already with an initial set of
// data stored in Elasticsearch.
var prefillURLs = function() {
	elastic.search( {
		index: process.env.ES_URL_INDEX,
		type: "url",
		body: {
			size: 5000,
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
			scan_urls.push( response.hits.hits[ j ]._source.url );
		}
		util.log( "Prefill: " + scan_urls.length + " URLs to scan" );
	} );
};

// Stores a list of URLs in Elasticsearch with a bulk request.
var storeURLs = function( response ) {
	var bulk_body = response.body;
	var urls = response.urls;

	return new Promise( function( resolve, reject ) {
		elastic.bulk( {
			body: bulk_body
		}, function( err, response ) {
			if ( undefined !== typeof response ) {
				stored_urls = stored_urls.concat( urls );
				resolve();
			} else {

				// @todo should some URLs be added back to store_urls?
				reject( "Bulk URL storage not successful: " + err.message );
			}
		} );
	} );
};

// Queues all waiting URLs for scan.
var scanURLs = function() {
	util.log( "Queue: " + scan_urls.length + " URLs" );
	c.queue( scan_urls );
	scan_urls = [];
};

/**
 * Updates a URLs record with the results of a URL scan.
 *
 * @param url {string}
 * @param data {object}
 */
var updateURLData = function( url, data ) {
	var d = new Date();

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
		if ( 0 === response.hits.hits.length ) {
			scan_urls.push( url ); // Requeue the URL to be scanned.
			util.log( "Error: " + url + " No record found to update" );
		} else {
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
			} ).then( function() {
				scanned_urls.push( url );
				util.log( "Updated: " + url );
			}, function( error ) {
				scan_urls.push( url );
				util.log( "Error: " + url + " " + error.message );
			} );
		}
	} );
};

// Parse a crawl result for anchor elements and determine if individual href
// attributes should be marked to scan or to store based on existing data.
var handleCrawlResult = function( res ) {
	return new Promise( function( resolve, reject ) {
		var reject_message = "";

		var url_update = {
			identity_version: "unknown",
			global_analytics: "unknown",
			status_code: res.statusCode,
			redirect_url: "",
			anchors: []
		};

		// Watch for URLs that do not respond as a 200 OK.
		if ( 200 !== res.statusCode ) {

			// If a 301 or 302, a location for the new URL will be available.
			if ( "undefined" !== typeof res.headers.location ) {
				var url = parse_href.get_url( res.headers.location, res.options.uri );

				// Mark un-scanned URLS to be scanned.
				if ( url && url !== res.options.uri && -1 >= scanned_urls.indexOf( url ) && -1 >= scan_urls.indexOf( url ) ) {
					scan_urls.push( url );
				}

				// Mark un-stored URLs to be stored.
				if ( url && -1 >= stored_urls.indexOf( url ) && -1 >= store_urls.indexOf( url ) ) {
					store_urls.push( url );
				}

				url_update.redirect_url = url;
			} else {

				// This is likely a 404, 403, 500, or other error code.
				reject_message = "Error in handleCrawlResult: " + res.statusCode + " response code";
			}
		} else if ( "pdf" === res.request.uri.pathname.split( "." ).pop() ) {
			url_update.status_code = 900;

		} else if ( /http-equiv="refresh"/i.test( res.body ) ) {
			url_update.status_code = 301;

			// PhantomJS has problems processing pages that auto redirect.
			reject_message = "Error in handleCrawlResult: page body contains http-equiv refresh";
		} else if ( /top.location.href/i.test( res.body ) || /window.location.href/i.test( res.body ) ) {
			url_update.status_code = 301;

			// PhantomJS has problems processing pages that auto redirect.
			reject_message = "Error in handleCrawlResult: page body appears to contain refresh script";
		} else if ( "undefined" === typeof res.$ ) {
			url_update.status_code = 999;

			reject_message = "Error in handleCrawlResult: Non HTML URL " + res.options.uri;
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
					if ( url !== res.options.uri && -1 >= scanned_urls.indexOf( url ) && -1 >= scan_urls.indexOf( url ) ) {
						scan_urls.push( url );
					}

					// If a URL has not been stored and is not slated to be stored,
					// mark it to be stored.
					if ( -1 >= stored_urls.indexOf( url ) && -1 >= store_urls.indexOf( url ) ) {
						store_urls.push( url );
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

		if ( 0 === store_urls.length ) {
			reject( "Result: No new unique URLs." );
		} else if ( "" !== reject_message ) {
			reject( reject_message );
		} else {
			resolve();
		}
	} );
};

// Checks a list of URLs against those currently stored in Elasticsearch
// so that storage of duplicate URLs is avoided.
var checkURLStore = function() {
	var local_store_urls = store_urls;
	store_urls = [];

	return new Promise( function( resolve, reject ) {
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
			var indexed_urls = 0;

			if ( 0 !== resp.hits.hits.length ) {
				indexed_urls = resp.hits.total;

				for ( var j = 0, y = resp.hits.hits.length; j < y; j++ ) {
					var index = local_store_urls.indexOf( resp.hits.hits[ j ]._source.url );
					if ( -1 < index ) {
						local_store_urls.splice( index, 1 );
						stored_urls.push( resp.hits.hits[ j ]._source.url );
					}
				}
			}

			var bulk_body = [];

			for ( var i = 0, x = local_store_urls.length; i < x; i++ ) {
				var url = parse_url.parse( local_store_urls[ i ] );

				bulk_body.push( { index: { _index: process.env.ES_URL_INDEX, _type: "url" } } );
				bulk_body.push( { url: local_store_urls[ i ], domain: url.hostname } );
			}

			if ( 0 !== bulk_body.length ) {
				util.log( "Result: " + found_urls + " found, " + indexed_urls + " exist, " + local_store_urls.length + " new" );
				resolve( { body: bulk_body, urls: local_store_urls } );
			} else {
				reject( "Result: " + found_urls + " found, " + indexed_urls + " exist, 0 new" );
			}
		}, function( err ) {
			reject( "Error in checkURLStore:: " + err.message );
		} );
	} );

};

// Outputs a common set of data after individual crawls and, if needed,
// queues up the next request.
var finishResult = function() {
	util.log( "Status: " + scanned_urls.length + " scanned, " + stored_urls.length + " stored" );

	// Continue scanning until no URLs are left.
	if ( 0 !== scan_urls.length  ) {
		scanURLs();
	}
};

// A callback for Crawler
var handleCrawl = function( error, result, done ) {
	if ( error ) {
		util.log( "ERROR: " + error.message );
		finishResult( result );
	} else {
		handleCrawlResult( result )
			.then( function() { finishResult();	} )
			.catch( function( error ) {
				util.log( error );
				finishResult();
			} );
	}
	done();
};

var c = new Crawler( {
	rateLimit: 100,
	maxConnections: 10,
	maxRedirects: 0,
	followRedirect: false,
	retries: 0,
	retryTimeout: 1000,
	timeout: 4000,
	userAgent: "WSU Web Crawler: web.wsu.edu/crawler/",
	callback: handleCrawl
} );

var queueFoundURLStorage = function() {
	setTimeout( storeFoundURLs, 2000 );
};

var storeFoundURLs = function() {
	checkURLStore()
		.then( storeURLs )
		.then( function() { queueFoundURLStorage(); } )
		.catch( function( error ) {
			util.log( error );
			queueFoundURLStorage();
		} );
};

// Prefill URLs to scan from those stored in the index.
prefillURLs();

// Start scanning URLs.
scanURLs();

// Handle the bulk storage of found URLs in another thread.
queueFoundURLStorage();
