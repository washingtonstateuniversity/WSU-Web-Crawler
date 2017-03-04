var Crawler = require( "crawler" );
var parse_url = require( "url" );

var allowed_domains = [ "wsu.edu" ];
var flagged_domains = [ "parking.wsu.edu", "www.parking.wsu.edu" ];
var scan_urls = [ "https://wsu.edu/" ];
var scanned_urls = [];

function build_href_url( href, source_uri ) {
	var url = parse_url.parse( href );

	// Catch tel:5093355555, mailto:user@email.edu, and javascript:window.print()
	// Ignore jshint so that "javascript:" is not falsely flagged as an issue.
	if ( "tel:" === url.protocol || "mailto:" === url.protocol || "javascript:" === url.protocol ) { // jshint ignore:line
		return false;
	}

	// Catch #
	if ( null === url.protocol && null === url.hostname && null === url.path ) {
		return false;
	}

	// Rebuild /relative/path/
	if ( null === url.protocol ) {
		var build_url = parse_url.parse( source_uri );
		url.path = url.path.replace( /^\//g, "" );
		url = parse_url.parse( build_url.protocol + "//" + build_url.hostname + "/" + url.path );
	}

	var root_domain_parts = {};
	root_domain_parts.full = url.hostname.split( "." );
	root_domain_parts.tld = root_domain_parts.full.pop();
	root_domain_parts.top = root_domain_parts.full.pop();
	var top_domain = root_domain_parts.top + "." + root_domain_parts.tld;

	if ( -1 >= allowed_domains.indexOf( top_domain ) || -1 < flagged_domains.indexOf( url.hostname ) ) {
		return false;
	}

	return url.href;
}

exports.build_href_url = build_href_url;

var c = new Crawler( {
    maxConnections: 10,
    callback: function( error, res, done ) {
        if ( error ) {
            console.log( error );
			return;
        } else {
            var $ = res.$;

			console.log( "Scanning " + res.options.uri );
			scanned_urls.push( res.options.uri );

			$( "a" ).each( function( index, value ) {
				if ( undefined !== value.attribs.href && "#" !== value.attribs.href ) {
					var url = build_href_url( value.attribs.href, res.options.uri );

					if ( false === url ) {
						return;
					}

					if ( -1 >= scanned_urls.indexOf( url.href ) && -1 >= scan_urls.indexOf( url.href ) ) {
						scan_urls.push( url.href );
					}
				}
			} );

			console.log( "Finished " + res.options.uri );
			console.log( "Scanned URLs: " + scanned_urls.length );
			console.log( "Remaining URLs to scan: " + scan_urls.length );

			if ( 10000 < scan_urls.length ) {
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
