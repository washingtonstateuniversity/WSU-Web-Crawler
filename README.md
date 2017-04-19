# WSU Web Crawler

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
* last_a11y_scan: date, epoch_millis
* force_a11y_scan: integer
* last_search_scan: date, epoch_millis
* force_search_scan: integer
* last_https_scan: date, epoch_millis
* force_https_scan: integer

This library only uses the `url` and `domain` data, but sets up a structure that can be used in the future by other libraries.

## Start the crawler

Once everything is configured, run `node index.js` to start crawling.

## Tests

A basic suite of tests using [tape](https://github.com/substack/tape) is available. Run these with `node tests/*.js`.
