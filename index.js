var Crawler = require( "crawler" );
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
var scan_limit = 4;

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

var storeURLs = function( bulk_body, urls ) {
	elastic.bulk( {
		body: bulk_body
	}, function( err, response ) {
		if ( undefined !== typeof response ) {
			store_urls = [];
			stored_urls = stored_urls.concat( urls );
			console.log( "Stored list of bulk URLs to ES" );
		} else {
			console.log( err );
		}
	} );
};

var scanNext = function() {
	var next_url = scan_urls.shift();
	c.queue( next_url );
};

var queueNext = function() {
	setTimeout( scanNext, 1500 );
}

var c = new Crawler( {
    maxConnections: 10,
    callback: function( error, res, done ) {
        if ( error ) {
            console.log( error );
			return;
        } else {
			if ( "undefined" === typeof res.$ ) {
				scanned_urls.push( res.options.uri );
				console.log( "Skip scanning non HTML URL " + res.options.uri );
				queueNext();
				return;
			}

            var $ = res.$;

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
				console.log( "No ES lookup needed, no URLs to store." );
				queueNext();
				return;
			}

			elastic.search( {
				index: process.env.ES_URL_INDEX,
				type: 'url',
				body: {
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
			} ).then( function ( resp ) {
				if ( 0 !== resp.hits.hits.length ) {
					console.log( resp.hits.total + " total URLS indexed from list of " + store_urls.length + " URLs" );

					for ( var j = 0, y = resp.hits.hits; j < y; j++ ) {
						console.log( resp.hit.hits[ j ] );
					}
					// Remove the stored URLs from the to be stored list.
				} else {
					console.log( "No URLs in this batch are currenlty stored." );
				}

				var bulk_body = [];

				for ( var i = 0, x = store_urls.length; i < x; i++ ) {
					var url = parse_url.parse( store_urls[ i ] );

					bulk_body.push( { index: { _index: process.env.ES_URL_INDEX, _type: "url" } } );
					bulk_body.push( { url: store_urls[ i ], domain: url.hostname } );
				}

				if ( 0 !== bulk_body.length ) {
					storeURLs( bulk_body, store_urls );
				}
			}, function (err) {
				console.trace(err.message);
			} );

			console.log( "Finished " + res.options.uri );
			console.log( "Scanned URLs: " + scanned_urls.length );
			console.log( "Remaining URLs to scan: " + scan_urls.length );

			// Stop scanning when no URLs are left to scan or when the limit has been reached.
			if ( 0 === scan_urls.length || ( 0 !== scan_limit && scan_limit < scanned_urls.length ) ) {
				return;
			} else {
				queueNext();
			}
        }
        done();
    }
} );

// Queue just one URL, with default callback
scanNext();
