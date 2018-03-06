# WSU Web Crawler

[![Build Status](https://travis-ci.org/washingtonstateuniversity/WSU-Web-Crawler.svg?branch=master)](https://travis-ci.org/washingtonstateuniversity/WSU-Web-Crawler)

Crawls URLs for URLs and stores URLs in Elasticsearch.

## Overview

The WSU Web Crawler maintains a record of URLs in Elasticsearch. These URLs are collected by crawling for all `href` attributes attached to anchor elements in a URL's HTML.

A series of priorities and schedules determines the order in which URLs are stored:

* URLs with a `search_scan_priority` value of 1 through 999.
* URLs that have never been scanned and do not have a `search_scan_date`.
* URLs with a `search_scan_date` of older than 24 hours.

Once a URL is scanned, its record is updated with a `search_scan_date` and the `search_scan_priority` is removed.

## Environment

Environment data is stored in a `.env` file that is not part of this repository. It should have values like:

```
ES_HOST="https://myelastic.domain"
ES_URL_INDEX="url-storage-index"
LOCK_KEY=1001
ROOT_DOMAINS="root.domain"
SKIP_DOMAINS="problem1.root.domain,problem2.root.domain"
START_URLS="https://root.domain"
```

* `ES_HOST` is the hostname of an Elasticsearch instance.
* `ES_URL_INDEX` is the name of the index where URL records should be stored.
* `LOCK_KEY` is the key attached to a single crawler instance. This can be used to run multiple crawlers on the same Elasticsearch data.
* `ROOT_DOMAINS` is a comma separated list of root domains that are allowed to be crawled.
* `SKIP_DOMAINS` is a comma separated list of subdomains that should be skipped.
* `START_URLS` is a comma separated list of URLs that should be used to populate the initial Elasticsearch setup.

## Schema

Before running the script, a schema should be defined for the `ES_URL_INDEX` in Elasticsearch and an initial URL record should be created from the URL(s) defined in `START_URLS`. Run `node setup_es.js` once your environment variables are defined to create this schema automatically.

The "url" type will have these mapped properties:

* url: keyword
* domain: keyword
* identity: keyword
* analytics: keyword
* title: text
* image: text
* description: text
* content: text
* status_code: integer
* redirect_url: keyword
* last_a11y_scan: date, epoch_millis
* a11y_scan_priority: integer
* last_search_scan: date, epoch_millis
* search_scan_priority: integer
* last_https_scan: date, epoch_millis
* https_scan_priority: integer
* last_anchor_scan: date, epoch_millis
* anchor_scan_priority: integer

An array of "anchors" found in the scan of a URL is also stored. Because Elasticsearch does not have a defined "array" type and we are not searching for this data, it is left out of the defined schema.

This library uses several of these properties and provides a structure that can be used in the future by other libraries.

### Scan priorities

Scan priority fields are used to set priority outside of the normal date based process and to lock records that are currently being scanned.

* If a scan priority field is set higher than 999, it is locked.
* `a11y_scan_priority` is set to *50* after a data collector scan. The accessibility collector uses this data.
* `anchor_scan_priority` is set to `50` after a data collector scan. The URL collector uses this data.
* `search_scan_priority` is set to `null` by the search data collector, indicating that the content is fresh.

### Status Code

In most cases, the standard status code returned for a request is logged. For some URLs, we hijack this status code so that we can apply different querying logic in the future.

* URLs that result in an error on crawl that can not be managed otherwise are logged with a status code of `800`.
* PDF URLs that respond with `200` are logged with the status code of `900`.
* `doc` and `docx` URLs that respond with `200` are logged with the status code of `901`.
* Spreadsheet URLs that respond with `200` are logged with the status code of `902`.
* Powerpoint URLs that respond with `200` are logged with the status code of `903`.
* Other URLs that respond with `200` but are filled with non-HTML content are logged with the status code of `999`.

## Local Development

Run `npm install` to install all production and development dependencies.

### Start the crawler

Once everything is configured, run `node data-collector.js` to start crawling.

### Tests

A basic suite of tests using [tape](https://github.com/substack/tape) is available. Run these with `node tests/*.js`.

## Deployment at WSU

A `Makefile` is included with the package to help build and deploy the script.

* Run `make build` to build a production copy that has a lighter `node_modules` footprint.
* Run `make deploy` to push a copy to production.

Manual work is still necessary on the server to replace the current running instance of the crawler.

* Navigate to `/home/ucadmin/web-crawler/`
* Extract `wsu-web-crawler.tar` into a new directory such as `url-crawler-002`
* Copy the current `.env` file from the previous crawler directory.
* Make sure all existing processes for the crawler are stopped.
* Start the new crawler process from its directory with `nohup node crawl.js >> ../url-crawler.log &`
