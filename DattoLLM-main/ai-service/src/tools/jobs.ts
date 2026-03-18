import type { ToolDef } from "./shared.js";
import { PAGE_PROPS, JOB_UID } from "./shared.js";

const DEVICE_UID_FOR_JOB = {
  deviceUid: { type: "string", description: "The unique ID (UID) of the device — use list-devices to find this. Check hasStdOut/hasStdErr in get-job-results before calling stdout/stderr tools" },
};

export const jobTools: ToolDef[] = [
  {
    name: "get-job",
    description: "Get status of a specific job (returns only 'active' or 'completed' — use get-job-results for detailed execution output). NOTE: there is no tool to list jobs; the user must provide the jobUid from the Datto RMM portal.",
    inputSchema: {
      type: "object",
      properties: { ...JOB_UID },
      required: ["jobUid"],
    },
  },
  {
    name: "get-job-components",
    description: "Get the components of a job. NOTE: there is no tool to list jobs; the user must provide the jobUid from the Datto RMM portal.",
    inputSchema: {
      type: "object",
      properties: { ...JOB_UID, ...PAGE_PROPS },
      required: ["jobUid"],
    },
  },
  {
    name: "get-job-results",
    description: "Get job execution results for a specific device. Returns jobDeploymentStatus and componentResults[] with hasStdOut/hasStdErr flags — check these before calling stdout/stderr tools. NOTE: there is no tool to list jobs; the user must provide the jobUid from the Datto RMM portal.",
    inputSchema: {
      type: "object",
      properties: {
        ...JOB_UID,
        deviceUid: { type: "string", description: "The unique ID (UID) of the device — use list-devices to find this. Check hasStdOut/hasStdErr in the results before calling stdout/stderr tools" },
      },
      required: ["jobUid", "deviceUid"],
    },
  },
  {
    name: "get-job-stdout",
    description: "Get the stdout output from a job execution. Only call this when get-job-results shows hasStdOut=true for the component. NOTE: there is no tool to list jobs; the user must provide the jobUid from the Datto RMM portal.",
    inputSchema: {
      type: "object",
      properties: { ...JOB_UID, ...DEVICE_UID_FOR_JOB },
      required: ["jobUid", "deviceUid"],
    },
  },
  {
    name: "get-job-stderr",
    description: "Get the stderr output from a job execution. Only call this when get-job-results shows hasStdErr=true for the component. NOTE: there is no tool to list jobs; the user must provide the jobUid from the Datto RMM portal.",
    inputSchema: {
      type: "object",
      properties: { ...JOB_UID, ...DEVICE_UID_FOR_JOB },
      required: ["jobUid", "deviceUid"],
    },
  },
];
