/*jshint scripturl:true*/
var test = require( "tape" );
var ParseHref = require( "../lib/parse-href" );

var source_uri = "https://wsu.edu";

var app = new ParseHref( {

	// These top level domains are allowed to be scanned by the crawler.
	allowed_root_domains: [
		"wsu.edu"
	],

	// These subdomains are flagged to not be scanned.
	flagged_domains: [
		"noscan.wsu.edu"
	],

	// These file extensions are flagged to not be scanned.
	flagged_extensions: [
		"pdf",
		"jpg",
		"jpeg",
		"gif",
		"xls",
		"doc",
		"png"
	],

	global_rules: {
		exclude_by: {
			starts_with: [
				"/global-exclude-path/",
			],
			contains: [
				"global-contains-text",
			]
		}
	},

	// Domain rules
	domain_rules: {
		"www.test.wsu.edu": {
			canonical: {
				hostname: "test.wsu.edu",
				protocol: "https"
			}
		},
		"test.wsu.edu": {
			exclude_by: {
				starts_with: [
					"/single-exclude-path/"
				],
				contains: [
					"/single-exclude-text/"
				]
			},
			bad_params: "(bad_param_one|bad_param_two)"
		}
	}
} );

test( "A standard URL from an allowed top level domain", function( t ) {
	var url = app.get_url( "https://wsu.edu/about/", source_uri );

	t.equal( url, "https://wsu.edu/about/" );
	t.end();
} );

test( "A URL with a hostname and protocol that has a canonical alternative", function( t ) {
	var url = app.get_url( "http://www.test.wsu.edu/about/", source_uri );

	t.equal( url, "https://test.wsu.edu/about/" );
	t.end();
} );

test( "A path should be built onto the source URI.", function( t ) {
	var url = app.get_url( "/about/life/", source_uri );

	t.equal( url, "https://wsu.edu/about/life/" );
	t.end();
} );

test( "A domain not on the allowed root domains list should be ignored.", function( t ) {
	var url = app.get_url( "https://google.com", source_uri );

	t.false( url );
	t.end();
} );

test( "A domain without a protocol should be treated as a relative path.", function( t ) {
	var url = app.get_url( "google.com", source_uri );

	t.equal( url, "https://wsu.edu/google.com" );
	t.end();
} );

test( "A filename without a protocol should be treated as a relative path.", function( t ) {
	var url = app.get_url( "asuperlongname.aspx", source_uri );

	t.equal( url, "https://wsu.edu/asuperlongname.aspx" );
	t.end();
} );

test( "A single slash should be treated as a relative path.", function( t ) {
	var url = app.get_url( "/", source_uri );

	t.equal( url, "https://wsu.edu/" );
	t.end();
} );

test( "A telephone URL should report as false", function( t ) {
	var url = app.get_url( "tel:15095551234", source_uri );

	t.false( url );
	t.end();
} );

test( "A mailto URL should report as false", function( t ) {
	var url = app.get_url( "mailto:email@email.edu", source_uri );

	t.false( url );
	t.end();
} );

test( "A javascript URL should report as false", function( t ) {
	var url = app.get_url( "javascript:onclick(do things)", source_uri );

	t.false( url );
	t.end();
} );

test( "A hash URL should report as false", function( t ) {
	var url = app.get_url( "#", source_uri );

	t.false( url );
	t.end();
} );

test( "A hash plus text URL should report as false", function( t ) {
	var url = app.get_url( "#anchor-name", source_uri );

	t.false( url );
	t.end();
} );

test( "A flagged domain should report as false", function( t ) {
	var url = app.get_url( "https://noscan.wsu.edu", source_uri );

	t.false( url );
	t.end();
} );

test( "A full URL with flagged file extension should report as false.", function( t ) {
	var url = app.get_url( "https://wsu.edu/files/2012.pdf", source_uri );

	t.false( url );
	t.end();
} );

test( "A full URL with flagged file extension in uppercase should report as false.", function( t ) {
	var url = app.get_url( "https://wsu.edu/files/2012.PDF", source_uri );

	t.false( url );
	t.end();
} );

test( "A full URL with flagged file extension and query string should report as false.", function( t ) {
	var url = app.get_url( "https://wsu.edu/files/2012.pdf?abc=123", source_uri );

	t.false( url );
	t.end();
} );

test( "A relative URL with flagged file extension should report as false.", function( t ) {
	var url = app.get_url( "2012.pdf", source_uri );

	t.false( url );
	t.end();
} );

test( "A path starting with excluded start text for a domain should report as false.", function( t ) {
	let url = app.get_url( "https://test.wsu.edu/single-exclude-path/another-path/" );

	t.false( url );
	t.end();
} );

test( "A path containing excluded text for a domain should report as false.", function ( t ) {
	let url = app.get_url( "https://test.wsu.edu/test/single-exclude-text/another-path/" );

	t.false( url );
	t.end();
} );

test( "A path containing excluded start text, but not starting with it, should return the URL.", function ( t ) {
	let url = app.get_url( "https://test.wsu.edu/test/single-exclude-path/another-path/" );

	t.equal( url, "https://test.wsu.edu/test/single-exclude-path/another-path/" );
	t.end();
} );

test( "A path starting with global excluded start text should report as false.", function ( t ) {
	let url = app.get_url( "https://test.wsu.edu/global-exclude-path/another-path/" );

	t.false( url );
	t.end();
} );

test( "A path containing globally excluded text should report as false.", function ( t ) {
	let url = app.get_url( "https://test.wsu.edu/test/global-contains-text/another-path/" );

	t.false( url );
	t.end();
} );

test( "A pathj containing bad parameters identified for a domain should remove those params.", function( t ) {
	let url = app.get_url( "https://test.wsu.edu/test/?one=keep&bad_param_one=remove&bad_param_two=remove&good_param=keep" );

	t.equal( url, "https://test.wsu.edu/test/?one=keep&good_param=keep" );
	t.end();
} )
