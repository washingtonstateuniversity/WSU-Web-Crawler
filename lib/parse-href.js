use 'strict';

// Processes an href attribute from an anchor into a valid URL.
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

	if ( null !== url.pathname ) {
		if ( -1 < flagged_extensions.indexOf( url.pathname.split( "." ).pop() ) ) {
			return false;
		}
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
