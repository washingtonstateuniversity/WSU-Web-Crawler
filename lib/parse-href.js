"use strict";

var parse_url = require( "url" );

function ParseHref( options ) {
	var self = this;

	self.options = options;
}

// Processes an href attribute from an anchor into a valid URL.
ParseHref.prototype.get_url = function get_url( href, source_uri ) {
	var self = this;
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
		if ( -1 < self.options.flagged_extensions.indexOf( url.pathname.split( "." ).pop().toLowerCase() ) ) {
			return false;
		}
	}

	// The WSU Plateau Portal has a discoverable URL count of over 2000000
	// because of how the CMS surfaces the information. This reduces the load
	// on that site. @todo Extract this into a custom WSU rule.
	if ( "plateauportal.libraries.wsu.edu" === url.hostname ) {
		var problematic_patterns = [
			"/digital-heritage/category/",
			"/digital-heritage/media-type/",
			"/digital-heritage/keywords/",
			"/digital-heritage/field_collection/",
			"/digital-heritage/community/",
			"/category/"
		];

		for ( let i = 0; i < problematic_patterns.length; i++ ) {
			if ( url.path.indexOf( problematic_patterns[ i ] ) === 0 ) {
				return false;
			}
		}
	}

	// There are a lot of combined tags that create many URL paths.
	if ( "www.tfrec.wsu.edu" === url.hostname && url.path.indexOf( "/pages/orgrte/browseD/" ) ) {
		return false;
	}

	// The calendar used at this domain generates a bunch of URLs.
	if ( "multicorereu.eecs.wsu.edu" === url.hostname && url.path.indexOf( "/calendar/" ) ) {
		return false;
	}

	// The research portal for WSU libraries also has a discoverable URL count over 200000,
	// many of which are held in these compounded filters.
	// @todo Extract this into a custom WSU rule.
	if ( "research.libraries.wsu.edu" === url.hostname && url.path.indexOf( "/xmlui/discover?" ) === 0 ) {
		return false;
	}

	// Exclude a bunch of Mediawiki views that do not change and are not informative to
	// WSU search or accessibility.
	// @todo Extract this into a custom WSU rule.
	if ( "wsm.wsu.edu" === url.hostname && url.path.indexOf( "/ourstory/index.php?title=Special:" ) === 0 ) {
		return false;
	}

	if ( "wsm.wsu.edu" === url.hostname && "" !== url.query ) {
		let parts = url.query.split( "&" );
		let new_parts = [];
		for ( let j = 0; j < parts.length; j++ ) {
			if ( 0 === parts[ j ].search( /(action|redlink|printable|oldid)/ ) ) {
				continue;
			}

			new_parts.push( parts[ j ] );
		}

		// Overwrite the previous HREF with only allowed query params.
		url.href = url.href.replace( url.query, new_parts.join( "&" ) );
	}

	if ( ( "digitalexhibits.libraries.wsu.edu" === url.hostname || "irishinitiative.libraries.wsu.edu" === url.hostname ) && "" !== url.query ) {
		let parts = url.query.split( "&" );
		let new_parts = [];
		for ( let j = 0; j < parts.length; j++ ) {
			if ( 0 === parts[ j ].search( /(sort_field|output)/ ) ) {
				continue;
			}

			new_parts.push( parts[ j ] );
		}

		// Overwrite the previous HREF with only allowed query params.
		url.href = url.href.replace( url.query, new_parts.join( "&" ) );
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

	if ( -1 >= self.options.allowed_domains.indexOf( top_domain ) || -1 < self.options.flagged_domains.indexOf( url.hostname ) ) {
		return false;
	}

	return url.href;
};

module.exports = ParseHref;
