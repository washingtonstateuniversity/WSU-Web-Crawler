# WSU Web Crawler

[![Build Status](https://travis-ci.org/washingtonstateuniversity/WSU-Web-Crawler.svg?branch=master)](https://travis-ci.org/washingtonstateuniversity/WSU-Web-Crawler)

Crawls URLs for URLs and stores URLs in Elasticsearch.

## Overview

Given an initial URL, say `https://wsu.edu/`, the WSU Web Crawler will parse its HTML for all `href` attributes attached to anchors.

* URLs found are marked as "to scan" if they have not been previously scanned.
* URLs found are marked as "to store" if they have not been previously stored.

URLs marked as "to store" are sent in batches to Elasticsearch. URLs marked as "to scan" or held in memory and used to repeat the process. Once no more URLs remain "to scan", or if a manual limit has been reached, the script will stop.

## Environment

Environment data is stored in a `.env` file that is not part of this repository. It should have values like:

```
ES_HOST="https://myelastic.domain"
ES_URL_INDEX="url-storage-index"
ROOT_DOMAINS="root.domain"
SKIP_DOMAINS="problem1.root.domain,problem2.root.domain"
START_URLS="https://root.domain"
```

## Schema

Before running the script, a schema should be defined for the `ES_URL_INDEX` in Elasticsearch. Run `node setup_es.js` to create this schema automatically.

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
* force_a11y_scan: integer
* last_search_scan: date, epoch_millis
* force_search_scan: integer
* last_https_scan: date, epoch_millis
* force_https_scan: integer

An array of "anchors" found in the scan of a URL is also stored. Because Elasticsearch does not have a defined "array" type and we are not searching for this data, it is left out of the defined schema.

This library uses several of these properties and provides a structure that can be used in the future by other libraries.

### Status Code

In most cases, the standard status code returned for a request is logged. For some URLs, we hijack this status code so that we can apply different querying logic in the future.

* PDF URLs that respond with `200` are logged with the status code of `900`.
* `doc` and `docx` URLs that respond with `200` are logged with the status code of `901`.
* Spreadsheet URLs that respond with `200` are logged with the status code of `902`.
* Powerpoint URLs that respond with `200` are logged with the status code of `903`.
* Other URLs that respond with `200` but are filled with non-HTML content are logged with the status code of `999`.

## Local Development

Run `npm install` to install all production and development dependencies.

### Start the crawler

Once everything is configured, run `node crawl.js` to start crawling.

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
