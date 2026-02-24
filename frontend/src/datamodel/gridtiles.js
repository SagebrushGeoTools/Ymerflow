import * as msgpack from "msgpack-lite";
import { unpackNumpy, packNumpy, unpackBinary, packBinary } from 'msgpack-numpy-js';
import { openDB } from "idb";


/*
  import {GeoOctreeLoader} from "./gridtiles.js";

const loader = new GeoOctreeLoader("/tiles");
loader.startBackgroundFetching();

const bbox = [1000,1000,0,2000,2000,100];
const grid = await loader.loadBBox(bbox);

const X = grid.getX();
const Y = grid.getY();
const Z = grid.getZ();
const T = grid.getVariable("temperature");

// X,Y,Z,T are all Float32Arrays of equal length
*/


class Tile {
  constructor(path, tileData){
    this.path = path;
    this.data = tileData;
    this.replaced = false;
  }
  intersectsBBox(bbox){
    const [minX,minY,minZ,maxX,maxY,maxZ] = this.data.bounds;
    const [bminX,bminY,bminZ,bmaxX,bmaxY,bmaxZ] = bbox;
    return !(bmaxX<minX || bminX>maxX ||
             bmaxY<minY || bminY>maxY ||
             bmaxZ<minZ || bminZ>maxZ);
  }
}

class BBoxGrid {
  constructor(){ this.points = []; this.variables = new Map(); }
  addTile(tile){
    const {variables} = tile.data;
    const nx = variables.x.length;
    for(let i=0;i<nx;i++){
      this.points.push({x:variables.x[i], y:variables.y[i], z:variables.z[i]});
      for(const v in variables){
        if(v==="x"||v==="y"||v==="z") continue;
        if(!this.variables.has(v)) this.variables.set(v, []);
        this.variables.get(v).push(variables[v][i]);
      }
    }
  }
  getX(){ return Float32Array.from(this.points.map(p=>p.x)); }
  getY(){ return Float32Array.from(this.points.map(p=>p.y)); }
  getZ(){ return Float32Array.from(this.points.map(p=>p.z)); }
  getVariable(varname){
    const arr = this.variables.get(varname);
    return arr ? Float32Array.from(arr) : null;
  }
}

export class GeoOctreeLoader {
  constructor(baseUrl){
    this.baseUrl = baseUrl;
    this.tiles = new Map();
    this.queue = [];
    this.dbPromise = openDB("octree-cache",1,{upgrade(db){ db.createObjectStore("tiles"); }});
    this.fetching = new Set();
    this.rootPath = "0_0_0.msgpack";
  }

  async fetchTile(path){
    if(this.tiles.has(path)) return this.tiles.get(path);
    const db = await this.dbPromise;
    let data = await db.get("tiles", path);
    if(data){ const tile = new Tile(path,data); this.tiles.set(path,tile); return tile; }

    if(this.fetching.has(path)) return;
    this.fetching.add(path);
    const res = await fetch(`${this.baseUrl}/${path}`);
    const buffer = await res.arrayBuffer();
    data = unpackBinary(new Uint8Array(buffer));
    const tile = new Tile(path,data);
    this.tiles.set(path,tile);
    await db.put("tiles",data,path);
    this.fetching.delete(path);
    return tile;
  }

  enqueueTile(path,priority=0){
    if(this.queue.find(q=>q.path===path)) return;
    this.queue.push({priority,path});
    this.queue.sort((a,b)=>b.priority-a.priority);
  }

  async backgroundFetcher(){
    while(true){
      if(this.queue.length===0){ await new Promise(r=>setTimeout(r,50)); continue; }
      const {path} = this.queue.shift();
      if(!this.tiles.has(path)) await this.fetchTile(path);
    }
  }

  async loadBBox(bbox){
    const root = await this.fetchTile(this.rootPath);
    const stack = [root];
    const highResTiles = [];
    const seen = new Set();

    while(stack.length){
      const tile = stack.pop();
      if(!tile.intersectsBBox(bbox)) continue;
      if(tile.data.children){
        for(const c of tile.data.children){
          if(!seen.has(c)){
            seen.add(c);
            const child = this.tiles.get(c) || await this.fetchTile(c);
            stack.push(child);
          }
        }
      } else {
        highResTiles.push(tile);
      }
    }

    // Push all relevant tiles to front of background queue
    highResTiles.forEach(t=>this.enqueueTile(t.path,100));

    // Evict fully replaced low-res tiles
    for(const [path, low] of this.tiles){
      if(low.data.children){
        const overlaps = highResTiles.some(h=>h.intersectsBBox(low.data.bounds));
        if(overlaps){ this.tiles.delete(path); }
      }
    }

    const grid = new BBoxGrid();
    highResTiles.forEach(t=>grid.addTile(t));
    return grid;
  }

  startBackgroundFetching(){ this.backgroundFetcher(); }
}
