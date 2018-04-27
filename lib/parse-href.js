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

	if ( -1 >= self.options.allowed_root_domains.indexOf( top_domain ) || -1 < self.options.flagged_domains.indexOf( url.hostname ) ) {
		return false;
	}

	// If a canonical hostname is set for a possible duplicate hostname or
	// schema, overwrite it with the canonical version.
	if ( url.hostname in self.options.domain_rules
		&& "undefined" !== typeof self.options.domain_rules[ url.hostname ].canonical ) {

		url.protocol = self.options.domain_rules[ url.hostname ].canonical.protocol;
		url.hostname = self.options.domain_rules[ url.hostname ].canonical.hostname;

		url = parse_url.parse( url.protocol + "://" + url.hostname + url.path );
	}

	// If path exclusion rules are defined for paths that start with a specific
	// pattern, and a URL path matches that pattern, return false.
	if ( url.hostname in self.options.domain_rules
		&& "undefined" !== typeof self.options.domain_rules[ url.hostname ].exclude_by
		&& "undefined" !== typeof self.options.domain_rules[ url.hostname ].exclude_by.starts_with ) {

		let problematic_patterns = self.options.domain_rules[ url.hostname ].exclude_by.starts_with;

		for ( let i = 0; i < problematic_patterns.length; i++ ) {
			if ( url.path.indexOf( problematic_patterns[ i ] ) === 0 ) {
				return false;
			}
		}
	}

	// If path exclusion rules are defined for paths that contain a specific
	// pattern, and a URL path matches that pattern, return false.
	if ( url.hostname in self.options.domain_rules
		&& "undefined" !== typeof self.options.domain_rules[ url.hostname ].exclude_by
		&& "undefined" !== typeof self.options.domain_rules[ url.hostname ].exclude_by.contains ) {

		let problematic_patterns = self.options.domain_rules[ url.hostname ].exclude_by.contains;

		for ( let i = 0; i < problematic_patterns.length; i++ ) {
			if ( url.path.indexOf( problematic_patterns[ i ] ) >= 0 ) {
				return false;
			}
		}
	}

	if ( "undefined" === typeof self.options.global_rules ) {
		self.options.global_rules = {};
	}

	// If a global path exclusion rule is defined for a path that starts with a
	// specific pattern, and a URL path matches that pattern, return false.
	if ( "undefined" !== typeof self.options.global_rules.exclude_by
		&& "undefined" !== typeof self.options.global_rules.exclude_by.starts_with ) {

		let problematic_patterns = self.options.global_rules.exclude_by.starts_with;

		for ( let i = 0; i < problematic_patterns.length; i++ ) {
			if ( url.path.indexOf( problematic_patterns[ i ] ) >= 0 ) {
				return false;
			}
		}
	}

	// If a global path exclusion rule is defined for a path that contains a
	// specific pattern, and a URL path matches that pattern, return false.
	if ( "undefined" !== typeof self.options.global_rules.exclude_by
		&& "undefined" !== typeof self.options.global_rules.exclude_by.contains ) {

		let problematic_patterns = self.options.global_rules.exclude_by.contains;

		for ( let i = 0; i < problematic_patterns.length; i++ ) {
			if ( url.path.indexOf( problematic_patterns[ i ] ) >= 0 ) {
				return false;
			}
		}
	}

	// If path exclusion rules are defined for paths that contain a specific
	// pattern, and a URL path matches that pattern, return false.
	if ( url.hostname in self.options.domain_rules
		&& "" !== url.query
		&& null !== url.query
		&& "undefined" !== typeof self.options.domain_rules[ url.hostname ].bad_params ) {

		let parts = url.query.split( "&" );
		let new_parts = [];
		let part_regex = new RegExp( self.options.domain_rules[ url.hostname ].bad_params, "g" );

		for ( let j = 0; j < parts.length; j++ ) {
			if ( 0 === parts[ j ].search( part_regex ) ) {
				continue;
			}

			new_parts.push( parts[ j ] );
		}

		// Overwrite the previous HREF with only allowed query params.
		url.href = url.href.replace( url.query, new_parts.join( "&" ) );
	}

	return url.href;
};

module.exports = ParseHref;
