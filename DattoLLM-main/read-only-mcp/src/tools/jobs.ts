import type { ToolDef } from "../api.js";
import { success, error } from "../api.js";

const PAGE_PROPS = {
  page: { type: "number", description: "Page number" },
  max: { type: "number", description: "Results per page" },
};

export const jobTools: ToolDef[] = [
  {
    name: "get-job",
    description: "Get status of a specific job (returns only 'active' or 'completed' — use get-job-results for detailed execution output). NOTE: there is no tool to list jobs; the user must provide the jobUid from the Datto RMM portal.",
    inputSchema: {
      type: "object",
      properties: { jobUid: { type: "string", description: "The unique ID (UID) of the job — NOTE: there is no tool to list jobs; the user must provide this from the Datto RMM portal" } },
      required: ["jobUid"],
    },
    handler: async (api, args) => {
      try {
        const data = await api.get(`/v2/job/${args["jobUid"]}`);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching job: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "get-job-components",
    description: "Get the components of a job. NOTE: there is no tool to list jobs; the user must provide the jobUid from the Datto RMM portal.",
    inputSchema: {
      type: "object",
      properties: {
        jobUid: { type: "string", description: "The unique ID (UID) of the job — NOTE: there is no tool to list jobs; the user must provide this from the Datto RMM portal" },
        ...PAGE_PROPS,
      },
      required: ["jobUid"],
    },
    handler: async (api, args) => {
      try {
        const { jobUid, ...query } = args;
        const data = await api.get(`/v2/job/${jobUid}/components`, query);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching job components: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "get-job-results",
    description: "Get job execution results for a specific device. Returns jobDeploymentStatus and componentResults[] with hasStdOut/hasStdErr flags — check these before calling stdout/stderr tools. NOTE: there is no tool to list jobs; the user must provide the jobUid from the Datto RMM portal.",
    inputSchema: {
      type: "object",
      properties: {
        jobUid: { type: "string", description: "The unique ID (UID) of the job — NOTE: there is no tool to list jobs; the user must provide this from the Datto RMM portal" },
        deviceUid: { type: "string", description: "The unique ID (UID) of the device — use list-devices to find this. Check hasStdOut/hasStdErr in the results before calling stdout/stderr tools" },
      },
      required: ["jobUid", "deviceUid"],
    },
    handler: async (api, args) => {
      try {
        const data = await api.get(`/v2/job/${args["jobUid"]}/results/${args["deviceUid"]}`);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching job results: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "get-job-stdout",
    description: "Get the stdout output from a job execution. Only call this when get-job-results shows hasStdOut=true for the component. NOTE: there is no tool to list jobs; the user must provide the jobUid from the Datto RMM portal.",
    inputSchema: {
      type: "object",
      properties: {
        jobUid: { type: "string", description: "The unique ID (UID) of the job — NOTE: there is no tool to list jobs; the user must provide this from the Datto RMM portal" },
        deviceUid: { type: "string", description: "The unique ID (UID) of the device — use list-devices to find this. Check hasStdOut/hasStdErr in get-job-results before calling stdout/stderr tools" },
      },
      required: ["jobUid", "deviceUid"],
    },
    handler: async (api, args) => {
      try {
        const data = await api.get(`/v2/job/${args["jobUid"]}/results/${args["deviceUid"]}/stdout`);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching job stdout: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
  {
    name: "get-job-stderr",
    description: "Get the stderr output from a job execution. Only call this when get-job-results shows hasStdErr=true for the component. NOTE: there is no tool to list jobs; the user must provide the jobUid from the Datto RMM portal.",
    inputSchema: {
      type: "object",
      properties: {
        jobUid: { type: "string", description: "The unique ID (UID) of the job — NOTE: there is no tool to list jobs; the user must provide this from the Datto RMM portal" },
        deviceUid: { type: "string", description: "The unique ID (UID) of the device — use list-devices to find this. Check hasStdOut/hasStdErr in get-job-results before calling stdout/stderr tools" },
      },
      required: ["jobUid", "deviceUid"],
    },
    handler: async (api, args) => {
      try {
        const data = await api.get(`/v2/job/${args["jobUid"]}/results/${args["deviceUid"]}/stderr`);
        return success(JSON.stringify(data, null, 2));
      } catch (e) {
        return error(`Error fetching job stderr: ${e instanceof Error ? e.message : e}`);
      }
    },
  },
];
