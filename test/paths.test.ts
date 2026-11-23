import assert from "node:assert/strict";
import { test } from "node:test";
import { pathKey } from "../shared/paths.ts";

test("the same Windows folder is one identity in any case or separator", () => {
	assert.equal(pathKey("D:\\Developer\\clean_data"), pathKey("d:\\developer\\CLEAN_DATA"));
	assert.equal(pathKey("D:/Developer/clean_data"), pathKey("D:\\developer\\clean_data"));
	assert.equal(pathKey("//server/Share/Proj"), pathKey("\\\\SERVER\\share\\PROJ"));
});

test("a drive root keeps its slash, so it is not read as a drive letter", () => {
	assert.equal(pathKey("C:\\"), "c:/");
	assert.equal(pathKey("C:/"), "c:/");
	assert.notEqual(pathKey("C:/"), pathKey("C:"));
});

test("POSIX paths stay case-sensitive", () => {
	assert.notEqual(pathKey("/a/B"), pathKey("/A/b"));
	assert.equal(pathKey("/a/B"), pathKey("/a/B/"));
});

test("repeated and trailing separators collapse", () => {
	assert.equal(pathKey("/work//proj///"), "/work/proj");
	assert.equal(pathKey("D:\\\\work\\\\proj\\\\"), "d:/work/proj");
	assert.equal(pathKey("  /work/proj  "), "/work/proj");
});
