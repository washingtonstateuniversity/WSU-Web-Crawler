/*jshint scripturl:true*/
var test = require( "tape" );
var ParseHref = require( "../lib/parse-href" );

var source_uri = "https://wsu.edu";

var app = new ParseHref( {

	// These top level domains are allowed to be scanned by the crawler.
	allowed_domains: [ "wsu.edu" ],

	// These subdomains are flagged to not be scanned.
	flagged_domains: [ "parking.wsu.edu", "www.parking.wsu.edu" ],

	// These file extensions are flagged to not be scanned.
	flagged_extensions: [ "pdf", "jpg", "jpeg", "gif", "xls", "doc", "png" ]
} );

test( "A standard URL from an allowed top level domain", function( t ) {
	var url = app.get_url( "https://wsu.edu/about/", source_uri );

	t.equal( url, "https://wsu.edu/about/" );
	t.end();
} );

test( "A path should be built onto the source URI.", function( t ) {
	var url = app.get_url( "/about/life/", source_uri );

	t.equal( url, "https://wsu.edu/about/life/" );
	t.end();
} );

test( "A domain not on the allowed domains list should be ignored.", function( t ) {
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
	var url = app.get_url( "https://parking.wsu.edu", source_uri );

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

test( "A /digital-heritage/category/ plateau portal path should report as false.", function( t ) {
	var url = app.get_url( "https://plateauportal.libraries.wsu.edu/digital-heritage/category/", source_uri );

	t.false( url );
	t.end();
} );

test( "A /digital-heritage/media-type/ plateau portal path should report as false.", function( t ) {
	var url = app.get_url( "https://plateauportal.libraries.wsu.edu/digital-heritage/media-type/", source_uri );

	t.false( url );
	t.end();
} );

test( "A /digital-heritage/keywords/ plateau portal path should report as false.", function( t ) {
	var url = app.get_url( "https://plateauportal.libraries.wsu.edu/digital-heritage/keywords/", source_uri );

	t.false( url );
	t.end();
} );

test( "A /digital-heritage/field_collection/ plateau portal path should report as false.", function( t ) {
	var url = app.get_url( "https://plateauportal.libraries.wsu.edu/digital-heritage/field_collection/", source_uri );

	t.false( url );
	t.end();
} );

test( "A /digital-heritage/community/ plateau portal path should report as false.", function( t ) {
	var url = app.get_url( "https://plateauportal.libraries.wsu.edu/digital-heritage/community/", source_uri );

	t.false( url );
	t.end();
} );

test( "A /xmlui/discover? research.libraries.wsu.edu path should report as false.", function( t ) {
	var url = app.get_url( "https://research.libraries.wsu.edu/xmlui/discover?filtertype=morethings", source_uri );

	t.false( url );
	t.end();
} );

test( "A relative /xmlui/discover? research.libraries.wsu.edu path should report as false.", function( t ) {
	var url = app.get_url( "xmlui/discover?filtertype=morethings", "https://research.libraries.wsu.edu" );

	t.false( url );
	t.end();
} );

test( "Any URL with a discover path at research.libraries.wsu.edu should report as false.", function( t ) {
	let url = app.get_url( "https://research.libraries.wsu.edu/xmlui/handle/2376/735/discover?filtertype=author&filter_relational_operator=authority&filter=68ea11a3-a3a4-4397-a2e0-bb457972be5d", source_uri );

	t.false( url );
	t.end();
} );

test( "Any URL with a relative discover path at research.libraries.wsu.edu should report as false.", function( t ) {
	let url = app.get_url( "https://research.libraries.wsu.edu/xmlui/handle/2376/735/discover?filtertype=author&filter_relational_operator=authority&filter=68ea11a3-a3a4-4397-a2e0-bb457972be5d", "https://research.libraries.wsu.edu" );

	t.false( url );
	t.end();
} );

test( "A /xmlui/search-filter? research.libraries.wsu.edu path should report as false.", function( t ) {
	var url = app.get_url( "https://research.libraries.wsu.edu/xmlui/search-filter?filtertype=morethings", source_uri );

	t.false( url );
	t.end();
} );

test( "A relative /xmlui/search-filter? research.libraries.wsu.edu path should report as false.", function( t ) {
	var url = app.get_url( "xmlui/search-filter?filtertype=morethings", "https://research.libraries.wsu.edu" );

	t.false( url );
	t.end();
} );

test( "A /xmlui/discover path on research.libraries.wsu.edu with no additional data should be allowed.", function( t ) {
	var url = app.get_url( "https://research.libraries.wsu.edu/xmlui/discover/", source_uri );

	t.equal( url, "https://research.libraries.wsu.edu/xmlui/discover/" );
	t.end();
} );

test( "A /catalog/product_compare path on Magento stores should report as false.", function( t ) {
	var url = app.get_url( "https://oc.store.wsu.edu/catalog/product_compare/add/product/33/uenc/aHR0cHM6Ly9vYy5zdG9yZS53c3UuZWR1L3RyYWluaW5nLW1hdGVyaWFscy9ib29rcy5odG1sP3A9Mg,,/form_key/iC2lOjHe5TVjOrON/", source_uri );

	t.false( url );
	t.end();
} );

test( "A wishlist path on Magento stores should report as false.", function( t ) {
	let url = app.get_url( "https://oc.store.wsu.edu/wishlist/index/add/product/34/form_key/EQDLDtfQfbMoMIk9/", source_uri );

	t.false( url );
	t.end();
} );

test( "A path starting with /ourstory/index.php?title=Special: on wsm.wsu.edu should report as false.", function( t ) {
	var url = app.get_url( "http://wsm.wsu.edu/ourstory/index.php?title=Special:WhatLinksHere/Geology_Field_Trip", source_uri );

	t.false( url );
	t.end();
} );

test( "A WSM URL should be stripped of action query parameters.", function( t ) {
	var url = app.get_url( "http://wsm.wsu.edu/ourstory/index.php?title=HelloWorld&action=nothing", source_uri );

	t.equal( url, "http://wsm.wsu.edu/ourstory/index.php?title=HelloWorld" );
	t.end();
} );

test( "A WSM URL should be stripped of redlink query parameters.", function( t ) {
	var url = app.get_url( "http://wsm.wsu.edu/ourstory/index.php?title=HelloWorld&redlink=1", source_uri );

	t.equal( url, "http://wsm.wsu.edu/ourstory/index.php?title=HelloWorld" );
	t.end();
} );

test( "A WSM URL should be stripped of printable query parameters.", function( t ) {
	var url = app.get_url( "http://wsm.wsu.edu/ourstory/index.php?title=HelloWorld&printable=yes", source_uri );

	t.equal( url, "http://wsm.wsu.edu/ourstory/index.php?title=HelloWorld" );
	t.end();
} );

test( "A WSM URL should be stripped of oldid query parameters.", function( t ) {
	var url = app.get_url( "http://wsm.wsu.edu/ourstory/index.php?title=HelloWorld&oldid=1234", source_uri );

	t.equal( url, "http://wsm.wsu.edu/ourstory/index.php?title=HelloWorld" );
	t.end();
} );

test( "A WSM URL should be stripped of multiple blocked query parameters.", function( t ) {
	var url = app.get_url( "http://wsm.wsu.edu/ourstory/index.php?title=HelloWorld&action=test&printable=yes&redlink=1&oldid=1234", source_uri );

	t.equal( url, "http://wsm.wsu.edu/ourstory/index.php?title=HelloWorld" );
	t.end();
} );

test( "A digital exchibits URL should be stripped of multiple blocked query parameters.", function( t ) {
	var url = app.get_url( "http://digitalexhibits.libraries.wsu.edu/items/browse?tags=France&sort_field=Dublin+Core%2CCreator&output=omeka-json", source_uri );

	t.equal( url, "http://digitalexhibits.libraries.wsu.edu/items/browse?tags=France" );
	t.end();
} );
