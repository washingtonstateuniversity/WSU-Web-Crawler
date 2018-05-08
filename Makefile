build:
	rm -f wsu-web-crawler.tar
	rm -rf build-package
	mkdir build-package
	cp package*.json build-package/
	cp -fr lib build-package/
	cp data-collector.js build-package/
	cp setup_es.js build-package/
	npm --prefix ./build-package/ install ./build-package/ --production
	rm -rf ./build-package/etc
	tar --create --file=wsu-web-crawler.tar build-package
