"use client";

import dynamic from "next/dynamic";

// 3D の描画（WebGL）はブラウザでしか動かないので、ブラウザだけで描く
export default dynamic(() => import("./Client"), { ssr: false });
