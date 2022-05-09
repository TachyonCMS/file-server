const path = require("path");
const fs = require("fs-extra");
const { nanoid } = require("nanoid");

const contentDataRootIx = process.argv.indexOf("--contentDataRoot");
let contentDataRoot = "/home/brian/sandbox/content/TachyonCMS";
/*
if (contentDataRootIx > -1) {
  const contentDataRootIn = process.argv[contentDataRootIx + 1];
  contentDataRoot = path.resolve(contentDataRootIn);
}
console.debug("Managing content in " + contentDataRoot);
*/
// The parent directory that we expect to find Flows defined in sub-directories.
const flowsDir = path.resolve(contentDataRoot + "/flows/");

// The parent directory that we expect to find Nuggets defined in sub-directories.
const nuggetsDir = path.resolve(contentDataRoot + "/nuggets/");

// OS specific path separator
const osSep = path.sep;

// Consistent "now" datetime
const getNow = () => {
  return new Date().toISOString();
};

// Add createdAt and modifiedAt timestamps
const initTimestamps = (data) => {
  if (!data.createdAt) {
    data.createdAt = new Date().toISOString();
  }
  data.updatedAt = "";
  return data;
};

// Set updatedAt timestamp
const setUpdatedAt = (data) => {
  data.updatedAt = new Date().toISOString();
  return data;
};

// Add id
const addId = (data) => {
  data.id = nanoid();
  return data;
};

const getJsonMulti = async (type, idArray) => {
  const objects = [];

  await Promise.all(
    idArray.map(async (objectId) => {
      console.log(objectId);
      let readResult = {};
      switch (type) {
        case "nugget":
          readResult = await readJson(
            [contentDataRoot, "nuggets", objectId],
            "nugget"
          );
          break;
        case "flow":
          readResult = await readJson(
            [contentDataRoot, "flows", objectId],
            "flow"
          );
          break;
      }

      if (readResult.status === "success") {
        objects.push(readResult.data);
      }
    })
  );

  return objects;
};

const ensureSubDir = async (contentDataRoot, subDir) => {
  const fullPath = contentDataRoot + osSep + subDir;
  try {
    if (existsSync(fullPath)) {
      return { lastLoadedAt: currentTime };
    }

    mkdirSync(fullPath);
  } catch (e) {
    return { error: "failed to create " + fullPath };
  }
};

const readJson = async (dirs = [], fileName) => {
  return new Promise((resolve, reject) => {
    try {
      const dirPath = dirs.join(osSep);
      const fullPath = dirPath.replace(/\/+$/, "") + osSep + fileName + ".json";
      console.log("fetching file data for: " + fullPath);

      fs.readFile(fullPath, "utf8", (err, fileData) => {
        if (err) {
          console.log("readJson error");
          console.error(err);
          reject({ status: "failure" });
        } else {
          const parsedData = JSON.parse(fileData);
          resolve({ status: "success", data: parsedData });
        }
      });
    } catch (e) {
      console.error(e);
      reject({ status: "failure" });
    }
  });
};

// Write a JSON file, all logic should have been applied before this.
const writeJson = async (dirs = [], fileName, fileData) => {
  return new Promise((resolve, reject) => {
    try {
      const dirPath = dirs.join(osSep);
      const fullPath = dirPath.replace(/\/+$/, "") + osSep + fileName + ".json";
      console.log("writing to: " + fullPath);

      const jsonString = JSON.stringify(fileData, null, 2);

      fs.writeFile(fullPath, jsonString);
      resolve({ status: "success", data: fileData });
    } catch (e) {
      console.error(e);
      reject({ status: "failure" });
    }
  });
};

const getDirs = async (startDir) => {
  // All filesystem entries in that directory
  const dirEntries = await fs.readdir(startDir, { withFileTypes: true });

  // Filter out the directories.
  const dirs = dirEntries.filter((de) => de.isDirectory()).map((de) => de.name);

  return dirs;
};

const deleteDir = async (dirs = []) => {
  try {
    const dirPath = dirs.join(osSep);
    fs.rm(dirPath, { recursive: true }).then(() => {
      return { status: "success", deleted: dirPath };
    });
  } catch (e) {
    console.log(e);
    return { status: "failure" };
  }
};

// Get all the flows found in the designated directory
const getAllFlows = async () => {
  // If we find any flows on disk we'll merge them this array
  const defaultFlows = [];

  const dirs = await getDirs(flowsDir);

  const fileFlows = await getJsonMulti("flow", dirs);

  const flows = [...defaultFlows, ...fileFlows];

  return flows;
};

// Create a new Flow
const createFlow = async (flow) => {
  addId(flow);
  initTimestamps(flow);

  const jsonString = JSON.stringify(flow, null, 2);
  const flowDir = contentDataRoot + "/flows/" + flow.id;

  try {
    await fs.ensureDir(flowDir);
  } catch (e) {
    console.log("Failed to create Flow directory: " + flowDir);
  }

  await fs.writeFile(flowDir + "/flow.json", jsonString);

  return flow;
};

// Delete a Flow
// Deletes entire Flow directory, Nuggets are not deleted as hey may be shared.
// A script will delete unlinked nuggets async and out of band.
const deleteFlow = async (flowId) => {
  const targetDirs = [contentDataRoot, "flows", flowId];
  return deleteDir(targetDirs);
};

// Get a single Flow with its associated data
const getFlowData = async (flowId, dataType) => {
  try {
    // Define valid types to scrub input
    const validDataType = ["flow", "nuggetSeq"];
    // Only load known types
    if (validDataType.includes(dataType)) {
      const flowDirs = [contentDataRoot, "flows", flowId];
      flow = await readJson(flowDirs, dataType);
      return flow;
    }
  } catch (e) {
    console.error(e);
    throw new Error("Invalid Request for " + flowId);
  }
};

// Merge an update into a well named object file
const mergeUpdate = async (objType, objId, partialData) => {
  // A guard to make sure the id in the object doesn't get used.
  delete partialData.id;

  // Updated the updatedAt timestamp
  setUpdatedAt(partialData);

  // All data requests are sandboxed to the root
  let targetDirs = [contentDataRoot];
  let targetFile;

  // Type specific logic for path and file name
  switch (objType) {
    case "flow":
      targetDirs.push("flows", objId);
      targetFile = "flow";
      break;

    case "nugget":
      targetDirs.push("nuggets", objId);
      targetFile = "nugget";
      break;
  }

  try {
    // Fetch current data
    const currentData = await readJson(targetDirs, targetFile);
    // Merge old and new data
    const mergedData = { ...currentData.data, ...partialData };
    // Write the JSON file
    await writeJson(targetDirs, targetFile, mergedData);
    return mergedData;
  } catch (e) {
    console.error(e);
    throw new Error(e);
  }
};

//exports.osSep = osSep;
//exports.getNow = getNow;
//exports.initTimestamps = initTimestamps;
//exports.setUpdatedAt = setUpdatedAt;
//exports.addId = addId;
//exports.getJsonMulti = getJsonMulti;
//exports.ensureSubDir = ensureSubDir;
//exports.readJson = readJson;
//exports.getDirs = getDirs;
exports.getAllFlows = getAllFlows;
exports.createFlow = createFlow;
exports.mergeUpdate = mergeUpdate;
exports.deleteFlow = deleteFlow;
exports.getFlowData = getFlowData;
