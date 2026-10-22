// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { createMakaronMcpServer } from '@/mcp/server';

describe('Kling MCP public contract', () => {
  it('removes O3 from advertised tools and rejects it before billing callbacks', async () => {
    const before = vi.fn(async () => ({ allowed:true }));
    const submit = vi.fn(async () => ({success:true,taskId:'candidate',message:'test receipt'}));
    const server=createMakaronMcpServer({onToolStart:before,submitVideo:submit});
    const client=new Client({name:'kling-contract-test',version:'1'});
    const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport); await client.connect(clientTransport);
    try {
      const {tools}=await client.listTools();
      for(const name of ['makaron_create_video','makaron_edit_video']) {
        const model=(tools.find(t=>t.name===name)!.inputSchema.properties!.videoModel as {enum:string[]});
        expect(model.enum).not.toContain('kling'); expect(model.enum).toContain('kling-4');
      }
      const rejected=await client.callTool({name:'makaron_create_video',arguments:{script:'old',images:[],videoModel:'kling'}});
      expect(rejected.isError).toBe(true); expect(before).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
      const accepted=await client.callTool({name:'makaron_create_video',arguments:{script:'Shot 1 (30s): continuous take',images:[],videoModel:'kling-4',duration:30,videoResolution:'1080p'}});
      expect(accepted.isError).not.toBe(true);
      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit).toHaveBeenCalledWith(expect.objectContaining({videoModel:'kling-4',duration:30,videoResolution:'1080p'}),'makaron_create_video');
    } finally { await client.close(); await server.close(); }
  });
});
