var Crawler = require( "crawler" );
var parse_href = require( "./lib/parse-href" );

// Tracks the list of URLs to be scanned.
var scan_urls = [ "https://wsu.edu/" ];

// Tracks the list of URLs scanned.
var scanned_urls = [];

// Number of URLs to scan before quitting. 0 indicates scan until done.
var scan_limit = 0;

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

					if ( -1 >= scanned_urls.indexOf( url ) && -1 >= scan_urls.indexOf( url ) ) {
						scan_urls.push( url );
					}
				}
			} );

			console.log( "Finished " + res.options.uri );
			console.log( "Scanned URLs: " + scanned_urls.length );
			console.log( "Remaining URLs to scan: " + scan_urls.length );

			// Stop scanning when no URLs are left to scan or when the limit has been reached.
			if ( 0 === scan_urls.length || ( 0 !== scan_limit && scan_limit < scanned_urls.length ) ) {
				dumplogs();
				return;
			} else {
				setTimeout( scanNext, 1500 );
			}
        }
        done();
    }
} );

var dumplogs = function() {
	console.log( scanned_urls );
	console.log( scan_urls );
};

var scanNext = function() {
	var next_url = scan_urls.shift();
	c.queue( next_url );
};

// Queue just one URL, with default callback
//c.queue( scan_urls );
