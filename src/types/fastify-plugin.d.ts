// Declaration file for fastify-plugin
declare module 'fastify-plugin' {
  import { FastifyPluginCallback } from 'fastify';
  
  export interface PluginOptions {
    fastify?: string;
    name?: string;
  }
  
  export default function fastifyPlugin<T extends FastifyPluginCallback>(
    plugin: T,
    options?: PluginOptions
  ): T;
}
