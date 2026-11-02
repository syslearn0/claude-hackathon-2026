"use client";

import dynamic from "next/dynamic";

// 位置情報や端末内の保存を最初から読むので、ブラウザだけで描く
export default dynamic(() => import("./Client"), { ssr: false });
