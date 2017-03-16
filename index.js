var Crawler = require( "crawler" );
var Promise = require( "promise" );
var parse_url = require( "url" );
var ParseHref = require( "./lib/parse-href" );
var es = require( "elasticsearch" );

require( "dotenv" ).config();

// Tracks the list of URLs to be scanned.
var scan_urls = [ "https://wsu.edu/" ];

// Tracks the list of URLs scanned.
var scanned_urls = [];

// Tracks the list of URLs to be stored.
var store_urls = [];

// Tracks the list of URLs stored.
var stored_urls = [];

// Number of URLs to scan before quitting. 0 indicates scan until done.
var scan_limit = 15;

var parse_href = new ParseHref( {

	// These top level domains are allowed to be scanned by the crawler.
	allowed_domains: [ "wsu.edu" ],

	// These subdomains are flagged to not be scanned.
	flagged_domains: [ "parking.wsu.edu", "www.parking.wsu.edu" ],

	// These file extensions are flagged to not be scanned.
	flagged_extensions: [ "pdf", "jpg", "jpeg", "gif", "xls", "doc", "png" ]
} );

var elastic = new es.Client( {
	host: process.env.ES_HOST,
	log: "error"
} );

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
				console.log( urls.length + " URLS stored in bulk to Elasticsearch." );
				resolve();
			} else {
				console.log( err );
				reject( "Bulk URL storage not successful: " + err.message );
			}
		} );
	} );
};

var scanNext = function() {
	var next_url = scan_urls.shift();
	c.queue( next_url );
};

var queueNext = function() {
	setTimeout( scanNext, 1500 );
};

var handleCrawlResult = function( res ) {
	var $ = res.$;

	return new Promise( function( resolve, reject ) {
		console.log( "Scanning " + res.options.uri );
		scanned_urls.push( res.options.uri );

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
			}
		} );

		if ( 0 === store_urls.length ) {
			reject( "No URLs to store from this scan." );
		} else {
			console.log( store_urls.length + " URLs to store from this scan." );
			resolve();
		}
	} );
};

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
			if ( 0 !== resp.hits.hits.length ) {
				console.log( resp.hits.total + " URLS already indexed." );

				for ( var j = 0, y = resp.hits.hits.length; j < y; j++ ) {
					var index = store_urls.indexOf( resp.hits.hits[ j ]._source.url );
					if ( -1 < index ) {
						store_urls.splice( index, 1 );
					}
				}
			} else {
				console.log( "0 URLs already indexed." );
			}

			var bulk_body = [];

			for ( var i = 0, x = store_urls.length; i < x; i++ ) {
				var url = parse_url.parse( store_urls[ i ] );

				bulk_body.push( { index: { _index: process.env.ES_URL_INDEX, _type: "url" } } );
				bulk_body.push( { url: store_urls[ i ], domain: url.hostname } );
			}

			if ( 0 !== bulk_body.length ) {
				console.log( store_urls.length + " URLs to store from this batch." );
				resolve( { body: bulk_body, urls: store_urls } );
			} else {
				reject( "No URLs to store." );
			}
		}, function( err ) {
			reject( "Error checking for URLs to store: " + err.message );
		} );
	} );

};

var isValidCrawlResult = function( result ) {
	return new Promise( function( resolve, reject ) {
		if ( "undefined" === typeof result.$ ) {
			scanned_urls.push( result.options.uri );
			reject( "Skip scanning non HTML URL " + result.options.uri );
		} else {
			resolve( result );
		}
	} );
};

// A callback for Crawler
var handleCrawl = function( error, result, done ) {
	if ( error ) {
		console.log( "There was a crawler error." );
		console.log( error );
		return;
	} else {

		isValidCrawlResult( result ).then( handleCrawlResult )
									.then( checkURLStore )
									.then( storeURLs )
									.then( function() {
			console.log( "Finished " + result.options.uri );
			console.log( "Scanned URLs: " + scanned_urls.length );
			console.log( "Total Stored: " + stored_urls.length );
			console.log( "Remaining URLs to scan: " + scan_urls.length );
			console.log( "" );

			// Stop scanning when no URLs are left to scan or when the limit has been reached.
			if ( 0 === scan_urls.length || ( 0 !== scan_limit && scan_limit < scanned_urls.length ) ) {
				return;
			} else {
				queueNext();
			}
		} ).catch( function( error ) {
			console.log( error );
			console.log( "Finished " + result.options.uri );
			console.log( "Scanned URLs: " + scanned_urls.length );
			console.log( "Total Stored: " + stored_urls.length );
			console.log( "Remaining URLs to scan: " + scan_urls.length );
			console.log( "" );

			// Stop scanning when no URLs are left to scan or when the limit has been reached.
			if ( 0 === scan_urls.length || ( 0 !== scan_limit && scan_limit < scanned_urls.length ) ) {
				return;
			} else {
				queueNext();
			}
		} );
	}
	done();
};

var c = new Crawler( {
    maxConnections: 10,
    callback: handleCrawl
} );

// Queue just one URL, with default callback
scanNext();
