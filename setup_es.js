"use strict";

require( "dotenv" ).config();

var elastic = {};
var elasticsearch = require( "elasticsearch" );

elastic.client = new elasticsearch.Client( {
	host: process.env.ES_HOST,
	log: "error"
} );

var createIndex = function() {
	elastic.client.indices.create( {
		index: process.env.ES_URL_INDEX,
		body: {
			mappings: {
				url: {
					properties: {
						url: {
							type: "keyword"
						},
						domain: {
							type: "keyword"
						},
						identity: {
							type: "keyword"
						},
						analytics: {
							type: "keyword"
						},
						title: {
							type: "text"
						},
						image: {
							type: "text"
						},
						description: {
							type: "text"
						},
						content: {
							type: "text"
						},
						status_code: {
							type: "integer"
						},
						redirect_url: {
							type: "keyword"
						},
						last_a11y_scan: {
							type: "date",
							format: "epoch_millis"
						},
						a11y_scan_priority: {
							type: "integer"
						},
						last_search_scan: {
							type: "date",
							format: "epoch_millis"
						},
						search_scan_priority: {
							type: "integer"
						},
						last_https_scan: {
							type: "date",
							format: "epoch_millis"
						},
						https_scan_priority: {
							type: "integer"
						},
						last_anchor_scan: {
							type: "date",
							format: "epoch_millis"
						},
						anchor_scan_priority: {
							type: "integer"
						}
					}
				}
			}
		}
	}, function( error, response ) {
		if ( undefined !== typeof response && true === response.acknowledged ) {
			console.log( "Index schema created." );
		} else {
			console.log( "Error with index creation." );
			console.log( error );
		}
	} );
};

elastic.client.indices.exists( {
	index: process.env.ES_INDEX
}, function( error, result ) {
	if ( true === result ) {
		console.log( "Index " + process.env.ES_URL_INDEX + " already exists, mapping cannot be recreated." );
		process.exit();
	} else {
		createIndex();
	}
} );
