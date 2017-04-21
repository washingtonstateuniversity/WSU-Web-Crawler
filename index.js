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
var store_urls = [];

// Tracks the list of URLs stored.
var stored_urls = [];

var parse_href = new ParseHref( {

	// These top level domains are allowed to be scanned by the crawler.
	allowed_domains: process.env.ROOT_DOMAINS.split( "," ),

	// These subdomains are flagged to not be scanned.
	flagged_domains: process.env.SKIP_DOMAINS.split( "," ),

	// These file extensions are flagged to not be scanned.
	flagged_extensions: [ "pdf", "jpg", "jpeg", "gif", "xls", "doc", "docx", "png" ]
} );

var elastic = new es.Client( {
	host: process.env.ES_HOST,
	log: "error"
} );

// Stores a list of URLs in Elasticsearch with a bulk request.
var storeURLs = function( response ) {
	var bulk_body = response.body;
	var urls = response.urls;

	return new Promise( function( resolve, reject ) {
		elastic.bulk( {
			body: bulk_body
		}, function( err, response ) {
			if ( undefined !== typeof response ) {
				store_urls = [];
				stored_urls = stored_urls.concat( urls );
				util.log( urls.length + " URLS stored in bulk to Elasticsearch." );
				resolve();
			} else {
				util.log( "Error storing bulk URLs: " + err.message );
				reject( "Bulk URL storage not successful: " + err.message );
			}
		} );
	} );
};

// Retrieves the next URL to be scanned and queues it for crawling.
var scanNext = function() {
	var next_url = scan_urls.shift();
	util.log( "Scanning " + next_url );
	c.queue( next_url );
};

// Queues the next URL crawl to occur after a short pause to
// avoid flooding servers with HTTP requests.
var queueNext = function() {
	setTimeout( scanNext, 1500 );
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
			util.log( "No record found for " + url + " to update?" );
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
						last_scan: d.getTime(),
						anchors: data.anchors
					}
				}
			} ).then( function() {
				util.log( "URL updated: " + url );
			}, function( error ) {
				util.log( "Error updating URL: " + error.message );
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
			redirect_url: '',
			anchors: []
		};

		scanned_urls.push( res.options.uri );

		// Watch for URLs that do not respond as a 200 OK.
		if ( 200 !== res.statusCode ) {
			// If a 301 or 302, a location for the new URL will be available.
			if ( 'undefined' !== typeof res.headers.location ) {
				var url = parse_href.get_url( res.headers.location, res.options.uri );

				// Mark un-scanned URLS to be scanned.
				if ( url && -1 >= scanned_urls.indexOf( url ) && -1 >= scan_urls.indexOf( url ) ) {
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
		} else if ( /http-equiv="refresh"/i.test( res.body ) ) {
			// PhantomJS has problems processing pages that auto redirect.
			reject_message = "Error in handleCrawlResult: page body contains http-equiv refresh";
		} else if ( "undefined" === typeof res.$ ) {
			reject_message = "Error in handleCrawlResult: Non HTML URL " + res.options.uri;
		} else {
			var $ = res.$;

			// Attempt to determine what identity a site is using.
			if ( /spine.min.js/i.test( res.body ) ) {
				url_update.identity_version = 'spine';
			} else if ( /spine.js/i.test( res.body ) ) {
				url_update.identity_version = 'spine';
			} else if ( /identifierv2.js/i.test( res.body ) ) {
				url_update.identity_version = 'identifierv2';
			} else {
				url_update.identity_version = 'other';
			}

			// Check if global analytics are likely in use.
			if ( /wsu_analytics/i.test( res.body ) ) {
				url_update.global_analytics = 'enabled';
			}

			// Check if enhanced global analytics via GTM are in use.
			if ( /GTM-K5CHVG/i.test( res.body ) ) {
				url_update.global_analytics = 'tag_manager';
			}

			$( "a" ).each( function( index, value ) {
				if ( undefined !== value.attribs.href && "#" !== value.attribs.href ) {
					var url = parse_href.get_url( value.attribs.href, res.options.uri );

					if ( false === url ) {
						return;
					}

					// If a URL has not been scanned and is not slated to be scanned,
					// mark it to be scanned.
					if ( -1 >= scanned_urls.indexOf( url ) && -1 >= scan_urls.indexOf( url ) ) {
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
	return new Promise( function( resolve, reject ) {
		elastic.search( {
			index: process.env.ES_URL_INDEX,
			type: "url",
			body: {
				size: 300,
				query: {
					bool: {
						filter: {
							terms: {
								url: store_urls
							}
						}
					}
				}
			}
		} ).then( function( resp ) {
			var found_urls = store_urls.length;
			var indexed_urls = 0;

			if ( 0 !== resp.hits.hits.length ) {
				indexed_urls = resp.hits.total;

				for ( var j = 0, y = resp.hits.hits.length; j < y; j++ ) {
					var index = store_urls.indexOf( resp.hits.hits[ j ]._source.url );
					if ( -1 < index ) {
						store_urls.splice( index, 1 );
						stored_urls.push( resp.hits.hits[ j ]._source.url );
					}
				}
			}

			var bulk_body = [];

			for ( var i = 0, x = store_urls.length; i < x; i++ ) {
				var url = parse_url.parse( store_urls[ i ] );

				bulk_body.push( { index: { _index: process.env.ES_URL_INDEX, _type: "url" } } );
				bulk_body.push( { url: store_urls[ i ], domain: url.hostname } );
			}

			if ( 0 !== bulk_body.length ) {
				util.log( "Result: " + found_urls + " found, " + indexed_urls + " exist, " + store_urls.length + " new" );
				resolve( { body: bulk_body, urls: store_urls } );
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
	util.log( "Status: " + scanned_urls.length + " scanned, " + stored_urls.length + " stored, " + scan_urls.length + " to scan" );

	// Continue scanning until no URLs are left.
	if ( 0 !== scan_urls.length  ) {
		queueNext();
	}
};

// A callback for Crawler
var handleCrawl = function( error, result, done ) {
	if ( error ) {
		util.log( "ERROR: " + error.message );
		finishResult( result );
	} else {
		handleCrawlResult( result )
			.then( checkURLStore )
			.then( storeURLs )
			.then( function() { finishResult();	} )
			.catch( function( error ) {
				util.log( error );
				finishResult();
			} );
	}
	done();
};

var c = new Crawler( {
	maxConnections: 10,
	maxRedirects: 0,
	followRedirect: false,
	retryTimeout: 4000,
	timeout: 4000,
	userAgent: "WSU Web Crawler: web.wsu.edu/crawler/",
	callback: handleCrawl
} );

// Queue just one URL, with default callback
scanNext();
