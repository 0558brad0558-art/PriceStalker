import axios from 'axios';
import { settingsCache } from '../../../utils/cache';
import { RetailerQueryService } from '../retailer/RetailerQueryService';
import { logger } from '../../../utils/system/logger';

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  domain: string;
  isSupported: boolean;
}

export class SearchService {
  private retailerQueryService = new RetailerQueryService();

  /**
   * Performs a product search using the configured SearXNG instance.
   */
  async search(query: string): Promise<SearchResult[]> {
    const enabled = await settingsCache.isSearXNGEnabled();
    const searxngUrl = await settingsCache.getSearXNGUrl();

    if (!enabled || !searxngUrl) {
      throw new Error('SearXNG search is disabled or not configured in System Settings');
    }

    try {
      const cleanBaseUrl = searxngUrl.endsWith('/') ? searxngUrl.slice(0, -1) : searxngUrl;
      const searchUrl = cleanBaseUrl.includes('/search') ? cleanBaseUrl : `${cleanBaseUrl}/search`;

      const response = await axios.get(searchUrl, {
        params: {
          q: query,
          format: 'json',
          engines: 'google,bing,duckduckgo'
        },
        headers: { Accept: 'application/json' },
        responseType: 'json',
        timeout: 15000
      });

      const rawResults = response.data?.results;
      if (!Array.isArray(rawResults)) {
        logger.error(
          `SearchService | SearXNG returned an unexpected response (HTTP ${response.status}, content-type ${response.headers['content-type'] || 'unknown'})`,
          'Product'
        );
        throw new Error('SearXNG did not return JSON search results. Check that JSON format is enabled on the SearXNG instance.');
      }

      const processedResults: SearchResult[] = [];

      for (const result of rawResults) {
        if (!result || typeof result.url !== 'string') continue;

        let urlObj: URL;
        try {
          urlObj = new URL(result.url);
          if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') continue;
        } catch {
          continue;
        }

        const domain = urlObj.hostname.replace(/^www\./, '');
        let isSupported = false;

        // Retailer classification must never decide whether a valid search
        // result is discarded. A database/config lookup failure only means
        // we cannot confirm support for that retailer.
        try {
          const config = await this.retailerQueryService.getRetailerForUrl(result.url);
          isSupported = !!config;
        } catch (error: any) {
          logger.error(
            `SearchService | Retailer lookup failed for ${domain}: ${error?.message || 'unknown error'}`,
            'Product'
          );
        }

        processedResults.push({
          title: result.title || domain,
          url: result.url,
          content: result.content || '',
          domain,
          isSupported
        });
      }

      logger.info(
        `SearchService | SearXNG returned ${rawResults.length} results; kept ${processedResults.length}`,
        'Product'
      );

      return processedResults;
    } catch (error: any) {
      logger.error('SearchService | SearXNG query failed', 'Product', error);

      if (error.code === 'ECONNABORTED') {
        throw new Error('SearXNG search timed out. Please check your network or SearXNG instance.');
      }

      throw new Error(`Search failed: ${error.response?.data?.error || error.message}`);
    }
  }
}
