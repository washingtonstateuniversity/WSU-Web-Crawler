module.exports = function( grunt ) {
	grunt.initConfig( {
		pkg: grunt.file.readJSON( "package.json" ),

		jscs: {
			scripts: {
				src: [ "./*.js", "./lib/*.js", "./tests/*.js" ],
				options: {
					preset: "jquery",
					requireCamelCaseOrUpperCaseIdentifiers: false, // We rely on name_name too much to change them all.
					maximumLineLength: 250,
					requireOperatorBeforeLineBreak: false,
					disallowTrailingComma: false
				}
			}
		},

		jshint: {
			grunt_script: {
				src: [ "Gruntfile.js" ],
				options: {
					curly: true,
					eqeqeq: true,
					noarg: true,
					quotmark: "double",
					undef: true,
					unused: false,
					node: true     // Define globals available when running in Node.
				}
			},
			crawler_script: {
				src: [ "./*.js", "./lib/*.js", "./tests/*.js" ],
				options: {
					esversion: 6,
					bitwise: true,
					curly: true,
					eqeqeq: true,
					forin: true,
					freeze: true,
					laxbreak: true,
					noarg: true,
					nonbsp: true,
					quotmark: "double",
					undef: true,
					unused: true,
					browser: true, // Define globals exposed by modern browsers.
					jquery: true,  // Define globals exposed by jQuery.
					predef: [
						"Promise"
					],
					node: true
				}
			}
		}
	} );

	grunt.loadNpmTasks( "grunt-jscs" );
	grunt.loadNpmTasks( "grunt-contrib-jshint" );

	// Default task(s).
	grunt.registerTask( "default", [ "jscs", "jshint" ] );
};
