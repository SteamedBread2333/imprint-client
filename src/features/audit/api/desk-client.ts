import { deskRequest } from "../../../platform/tauri/api";
import {
  docChunkSchema,
  docFileSchema,
  docSearchSchema,
  graphDataSchema,
  healthSchema,
  parseContract,
  unifiedGraphSchema,
} from "../domain/contracts";

export const deskClient = {
  async health() {
    return parseContract(healthSchema, await deskRequest({ operation: "health" }));
  },
  async graph() {
    return parseContract(graphDataSchema, await deskRequest({ operation: "graph" }));
  },
  async unifiedGraph() {
    return parseContract(
      unifiedGraphSchema,
      await deskRequest({ operation: "unifiedGraph" }),
    );
  },
  async ruleDetail(id: string) {
    return await deskRequest<Record<string, unknown>>({ operation: "ruleDetail", id });
  },
  async searchDocs(query: string) {
    return parseContract(
      docSearchSchema,
      await deskRequest({ operation: "docsSearch", query, top_k: 12 }),
    );
  },
  async docChunk(id: string) {
    return parseContract(docChunkSchema, await deskRequest({ operation: "docChunk", id }));
  },
  async docFile(path: string) {
    return parseContract(docFileSchema, await deskRequest({ operation: "docFile", path }));
  },
};
