var test = require('tape');
var app = require( "../lib/parse-href" );

var source_uri = "https://wsu.edu";

test( "A standard URL from an allowed top level domain", function( t ) {
	var url = app.build_href_url( "https://wsu.edu/about/", source_uri );

	t.equal( url, "https://wsu.edu/about/" );
	t.end();
} );

test( "A path should be built onto the source URI.", function( t ) {
	var url = app.build_href_url( "/about/life/", source_uri );

	t.equal( url, "https://wsu.edu/about/life/" );
	t.end();
} );

test( "A domain not on the allowed domains list should be ignored.", function( t ) {
	var url = app.build_href_url( "https://google.com", source_uri );

	t.false( url );
	t.end();
} );

test( "A domain without a protocol should be treated as a relative path.", function( t ) {
	var url = app.build_href_url( "google.com", source_uri );

	t.equal( url, "https://wsu.edu/google.com" );
	t.end();
})

test( "A filename without a protocol should be treated as a relative path.", function( t ) {
	var url = app.build_href_url( "asuperlongname.aspx", source_uri );

	t.equal( url, "https://wsu.edu/asuperlongname.aspx" );
	t.end();
} );

test( "A single slash should be treated as a relative path.", function( t ) {
	var url = app.build_href_url( "/", source_uri );

	t.equal( url, "https://wsu.edu/" );
	t.end();
} );

test( "A telephone URL should report as false", function( t ) {
	var url = app.build_href_url( "tel:15095551234", source_uri );

	t.false( url );
	t.end();
} );

test( "A mailto URL should report as false", function( t ) {
	var url = app.build_href_url( "mailto:email@email.edu", source_uri );

	t.false( url );
	t.end();
} );

test( "A javascript URL should report as false", function( t ) {
	var url = app.build_href_url( "javascript:onclick(do things)", source_uri );

	t.false( url );
	t.end();
} );

test( "A hash URL should report as false", function( t ) {
	var url = app.build_href_url( "#", source_uri );

	t.false( url );
	t.end();
} );

test( "A hash plus text URL should report as false", function( t ) {
	var url = app.build_href_url( "#anchor-name", source_uri );

	t.false( url );
	t.end();
} );

test( "A flagged domain should report as false", function( t ) {
	var url = app.build_href_url( "https://parking.wsu.edu", source_uri );

	t.false( url );
	t.end();
} );

test( "A full URL with flagged file extension should report as false.", function( t ) {
	var url = app.build_href_url( "https://wsu.edu/files/2012.pdf", source_uri );

	t.false( url );
	t.end();
} );

test( "A full URL with flagged file extension and query string should report as false.", function( t ) {
	var url = app.build_href_url( "https://wsu.edu/files/2012.pdf?abc=123", source_uri );

	t.false( url );
	t.end();
} );

test( "A relative URL with flagged file extension should report as false.", function( t ) {
	var url = app.build_href_url( "2012.pdf", source_uri );

	t.false( url );
	t.end();
} );
