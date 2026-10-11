"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getRootDirs", {
    enumerable: true,
    get: function() {
        return getRootDirs;
    }
});
// Local adaptation: see ../../README.md and ../../provenance.json.
var _tinyglobby = require("tinyglobby");
var _path = require("node:path");
var _fs = require("node:fs");
var normalizeDirectory = function(directory) {
    var normalized = directory.replace(/\\/g, '/');
    var root = _path.parse(directory).root.replace(/\\/g, '/');
    return normalized === root ? normalized : normalized.replace(/\/+$/, '');
};
/**
 * Process a Next.js root directory glob.
 */ var processRootDir = function(rootDir) {
    var pattern = rootDir.replace(/\\/g, '/');
    // A literal cwd becomes an empty matching pattern inside tinyglobby. Check
    // static roots directly; retain only existing directories, including links.
    if (!(0, _tinyglobby.isDynamicPattern)(pattern)) {
        try {
            return _fs.statSync(pattern).isDirectory() ? [normalizeDirectory(pattern)] : [];
        } catch (error) {
            if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
            throw error;
        }
    }
    return (0, _tinyglobby.globSync)(pattern, {
        onlyDirectories: true,
        expandDirectories: false,
        absolute: _path.isAbsolute(rootDir)
    }).map(normalizeDirectory);
};
var getRootDirs = function(context) {
    var rootDirs = [
        context.cwd
    ];
    var nextSettings = context.settings.next || {};
    var rootDir = nextSettings.rootDir;
    if (typeof rootDir === 'string') {
        rootDirs = processRootDir(rootDir);
    } else if (Array.isArray(rootDir)) {
        rootDirs = rootDir.map(function(dir) {
            return typeof dir === 'string' ? processRootDir(dir) : [];
        }).flat();
    }
    return rootDirs;
};
