/**
 * lan-access 插件 —— Node 端（服务端半部）。
 *
 * 职责：
 * - 注册 `/lan-info` 路由，向浏览器端提供局域网访问信息
 *   （是否已监听局域网、本机局域网 IPv4、访问 URL）。
 * - 局域网地址来源：webRuntime 服务在 webserver 绑定 0.0.0.0 时自动收集
 *   的全部非内网 IPv4 地址（见 dsh-web-app 的 resolveLanTrust）。
 *
 * 挂载：由 DSH Desktop 通过 --patch 注入行（默认关闭局域网监听时仅提供
 * 信息接口；开启时 patch 同时把 webserver host 覆盖为 0.0.0.0）。
 */
const name = "lan-access";
const inject = ["webServer", "webRuntime"];

/** 地址优先级：RFC1918 私有网段（真实局域网）优先，其它（VPN/虚拟网卡）靠后。 */
function lanPriority(ip) {
  if (/^192\.168\./.test(ip)) return 0;
  if (/^10\./.test(ip)) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
  return 3;
}

function bestLanAddress(addresses) {
  if (addresses.length === 0) return null;
  return [...addresses].sort((a, b) => lanPriority(a) - lanPriority(b))[0];
}

function apply(ctx) {
  // 注入 crypto.randomUUID polyfill：手机通过局域网 IP（http://192.168.x.x，
  // 非安全上下文）访问时该 API 不可用，会导致工作区选择等操作失败。
  // 通过 webserver 的 tapIndex 在 index.html 注入内联脚本（与 DSH 注入
  // __DSH_BOOT__ 同机制）；localhost 下原本就有该 API，polyfill 自动跳过。
  ctx.effect(
    () =>
      ctx.webServer.tapIndex((html) => {
        const tag =
          '<script>(function(){try{if(typeof crypto!=="undefined"&&typeof crypto.randomUUID!=="function"){crypto.randomUUID=function(){var b=crypto.getRandomValues(new Uint8Array(16));b[6]=b[6]&15|64;b[8]=b[8]&63|128;var h=Array.from(b,function(x){return x.toString(16).padStart(2,"0")});return h[0]+h[1]+h[2]+h[3]+"-"+h[4]+h[5]+"-"+h[6]+h[7]+"-"+h[8]+h[9]+"-"+h[10]+h[11]+h[12]+h[13]+h[14]+h[15]}}}catch(e){}})();</script>';
        return html.includes("</head>")
          ? html.replace("</head>", tag + "</head>")
          : tag + html;
      }),
    "lan-access: crypto.randomUUID polyfill",
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: "/lan-info",
        handler: async (req, res) => {
          const port = ctx.webServer.port;
          // webRuntime.lanAddresses 仅在 webserver 绑定 0.0.0.0 时由
          // resolveLanTrust 收集（非内网 IPv4 列表），是「已开启局域网监听」
          // 的可靠信号；127.0.0.1 时为 []。
          const lan = ctx.webRuntime?.lanAddresses ?? [];
          const enabled = lan.length > 0;
          const ip = enabled ? bestLanAddress(lan) : null;
          const payload = {
            enabled,
            ip,
            port,
            url: ip ? `http://${ip}:${port}` : null,
            lanAddresses: lan,
          };
          const body = JSON.stringify(payload);
          res.writeHead(200, {
            "content-type": "application/json",
            "cache-control": "no-store",
            "content-length": Buffer.byteLength(body),
          });
          res.end(body);
        },
      }),
    "lan-access: /lan-info route",
  );
}

export { apply, inject, name };
