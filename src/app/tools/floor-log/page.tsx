"use client";

import dynamic from "next/dynamic";

// 端末内の保存を最初から読むので、ブラウザだけで描く
export default dynamic(() => import("./Client"), { ssr: false });
