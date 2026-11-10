
import { Client } from 'pg';
import { logger } from '../../../utils/system/logger';
import {
  configCache,
  regionalMappingCache,
  settingsCache
} from '../../../utils/cache';

export function startSettingsListener() {
  if (process.env.NODE_ENV === 'test') return;

  const connectionString = process.env.DATABASE_DIRECT_URL;

  if (!connectionString) {
    logger.error(
      'Settings Listener | DATABASE_DIRECT_URL is missing',
      'Database'
    );
    return;
  }

  let client: Client | null = null;
  let reconnectTimeout: NodeJS.Timeout | null = null;

  async function connectAndListen() {
    const listener = new Client({
      connectionString
    });

    client = listener;

    try {
      await listener.connect();

      logger.info(
        'Settings Listener | Connected using direct database connection',
        'Database'
      );

      await listener.query('LISTEN settings_change');

      let debounceTimeout: NodeJS.Timeout | null = null;
      const pendingPayloads = new Set<string>();

      listener.on('notification', (msg) => {
        if (msg.channel === 'settings_change') {
          pendingPayloads.add(msg.payload || '');

          if (debounceTimeout) {
            clearTimeout(debounceTimeout);
          }

          debounceTimeout = setTimeout(() => {
            const payloads = Array.from(pendingPayloads).join(', ');

            logger.info(
              `Settings Listener | Notifications processed: [${payloads}]. Clearing cache.`,
              'System'
            );

            configCache.invalidate();
            regionalMappingCache.clear();
            settingsCache.clear();

            pendingPayloads.clear();
            debounceTimeout = null;
          }, 250);
        }
      });

      listener.on('error', (err) => {
        logger.error(
          'Settings Listener | Database client error',
          'Database',
          err
        );
        reconnect(listener);
      });

      listener.on('end', () => {
        logger.warn(
          'Settings Listener | Database connection ended',
          'Database'
        );
        reconnect(listener);
      });

    } catch (error) {
      logger.error(
        'Settings Listener | Failed to connect and listen',
        'Database',
        error
      );
      reconnect(listener);
    }
  }

  function reconnect(failedClient: Client) {
    if (client !== failedClient) return;

    client = null;

    failedClient.end().catch(() => {});

    if (reconnectTimeout) return;

    logger.info(
      'Settings Listener | Scheduling reconnection in 5 seconds',
      'Database'
    );

    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      connectAndListen();
    }, 5000);
  }

  connectAndListen();
}
