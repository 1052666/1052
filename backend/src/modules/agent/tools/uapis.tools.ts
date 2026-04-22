import type { AgentTool } from '../agent.tool.types.js'
import {
  callUapis,
  getUapisCatalog,
  readUapisApi,
  setUapisApiEnabled,
  setUapisApisEnabled,
} from '../../uapis/uapis.service.js'

export const uapisTools: AgentTool[] = [
  {
    name: 'uapis_list_apis',
    description:
      'List the enabled/disabled UAPIs built-in API catalog as a lightweight index. Read-only. Use before choosing a UAPIs API.',
    parameters: {
      type: 'object',
      properties: {
        enabledOnly: {
          type: 'boolean',
          description: 'When true, only return enabled APIs. Default true.',
        },
        categoryId: {
          type: 'string',
          description: 'Optional category id filter, such as search, network, image, translate.',
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const enabledOnly = input.enabledOnly === false ? false : true
      const categoryId = typeof input.categoryId === 'string' ? input.categoryId.trim() : ''
      const catalog = await getUapisCatalog()
      const apis = catalog.apis
        .filter((api) => (!enabledOnly ? true : api.enabled))
        .filter((api) => (!categoryId ? true : api.categoryId === categoryId))
        .map(({ id, categoryId, categoryName, name, method, path, description, enabled }) => ({
          id,
          categoryId,
          categoryName,
          name,
          method,
          path,
          description,
          enabled,
        }))
      return {
        provider: catalog.provider,
        categories: catalog.categories,
        counts: catalog.counts,
        apis,
      }
    },
  },
  {
    name: 'uapis_read_api',
    description:
      'Read detailed documentation for one UAPIs API, including parameters and examples. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        apiId: { type: 'string', description: 'UAPIs API id from uapis_list_apis.' },
      },
      required: ['apiId'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return readUapisApi(input.apiId)
    },
  },
  {
    name: 'uapis_set_api_enabled',
    description:
      'Enable or disable one UAPIs toolbox API. This is a configuration change. Use when the user asks Agent to manage toolbox capabilities.',
    parameters: {
      type: 'object',
      properties: {
        apiId: { type: 'string', description: 'UAPIs API id from uapis_list_apis.' },
        enabled: { type: 'boolean', description: 'true to enable, false to disable.' },
      },
      required: ['apiId', 'enabled'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return setUapisApiEnabled(input.apiId, { enabled: input.enabled as boolean })
    },
  },
  {
    name: 'uapis_bulk_set_enabled',
    description:
      'Enable or disable multiple UAPIs toolbox APIs, optionally limited to one category. This is a configuration change.',
    parameters: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'true to enable, false to disable.' },
        categoryId: {
          type: 'string',
          description: 'Optional UAPIs category id. Leave empty to affect every API.',
        },
      },
      required: ['enabled'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return setUapisApisEnabled({
        enabled: input.enabled as boolean,
        categoryId: typeof input.categoryId === 'string' ? input.categoryId : undefined,
      })
    },
  },
  {
    name: 'uapis_call',
    description:
      'Call one enabled UAPIs API. API Key is optional: the backend omits Authorization by default and automatically adds Bearer API Key only when the user configured one in Settings. This consumes UAPIs free/API-key quota.',
    parameters: {
      type: 'object',
      properties: {
        apiId: { type: 'string', description: 'UAPIs API id from uapis_list_apis.' },
        params: {
          type: 'object',
          description: 'Query string parameters for GET APIs, or optional query parameters for POST APIs.',
          additionalProperties: true,
        },
        body: {
          type: 'object',
          description: 'JSON body for POST APIs. Leave empty for GET APIs.',
          additionalProperties: true,
        },
      },
      required: ['apiId'],
      additionalProperties: false,
    },
    execute: async (args) => callUapis((args ?? {}) as Record<string, unknown>),
  },
]
