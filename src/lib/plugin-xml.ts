import { XMLParser } from 'fast-xml-parser';
import { create } from 'xmlbuilder2';
import fs from 'fs';

// ---- Types ----------------------------------------------------------------

export interface AccessField {
  table: string;
  field: string;
  access: string; // 'ViewOnly' | 'FullAccess'
}

export interface PluginLink {
  title: string;
  displayText: string;
  path: string;
  uiContextIds: string[];
}

export interface PluginXmlData {
  name: string;
  version: string;
  description: string;
  /** true if <oauth/> or <oauth accessLevelV1Api="..."/> is present */
  oauth: boolean;
  /** READ | FULL | NONE — only present when oauth is true */
  accessLevelV1Api?: string;
  autoinstall?: {
    required: boolean;
    autoenable?: { required: boolean };
    autoredeploy?: boolean;
  };
  /** Fields inside <access_request><field ...> */
  accessRequest: AccessField[];
  /** CDN names inside <access_request><cdn_request><cdn name="..."> */
  cdnRequest: string[];
  publisher: {
    name: string;
    contact: {
      email: string;
      phone?: string;
    };
  };
  /** Top-level <links> */
  links?: PluginLink[];
  /** <registration url="..."/> */
  registration?: { url: string };
  /** <openid host="..." port="..."> */
  openid?: {
    host: string;
    port: string;
    links?: PluginLink[];
  };
}

// ---- Parser config ---------------------------------------------------------

const PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  isArray: (name) =>
    ['field', 'link', 'ui_context', 'cdn', 'event_subscription'].includes(name),
});

// ---- Parse -----------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function parseLinks(linksBlock: unknown): PluginLink[] {
  if (!linksBlock || typeof linksBlock !== 'object') return [];
  const lb = linksBlock as Obj;
  const raw: unknown[] = Array.isArray(lb['link']) ? lb['link'] : lb['link'] ? [lb['link']] : [];
  return raw.map((l) => {
    const link = l as Obj;
    const uiContextIds: string[] = [];
    const uiCtxs = link['ui_contexts'];
    if (uiCtxs && typeof uiCtxs === 'object') {
      const ctxBlock = uiCtxs as Obj;
      const ctxArr: unknown[] = Array.isArray(ctxBlock['ui_context'])
        ? ctxBlock['ui_context']
        : ctxBlock['ui_context']
        ? [ctxBlock['ui_context']]
        : [];
      for (const c of ctxArr) {
        const id = asStr((c as Obj)['@_id']);
        if (id) uiContextIds.push(id);
      }
    }
    return {
      title: asStr(link['@_title']) ?? '',
      displayText: asStr(link['@_display-text']) ?? '',
      path: asStr(link['@_path']) ?? '',
      uiContextIds,
    };
  });
}

export function parsePluginXml(xmlString: string): PluginXmlData {
  const parsed = PARSER.parse(xmlString) as Obj;
  const p: Obj = parsed['plugin'] ?? {};

  // OAuth
  const hasOauth = 'oauth' in p;
  let accessLevelV1Api: string | undefined;
  if (hasOauth) {
    const oa = p['oauth'];
    if (oa && typeof oa === 'object') {
      const level = asStr(oa['@_accessLevelV1Api']);
      if (level) accessLevelV1Api = level;
    }
  }

  // Autoinstall
  let autoinstall: PluginXmlData['autoinstall'];
  if ('autoinstall' in p) {
    const ai = (p['autoinstall'] ?? {}) as Obj;
    autoinstall = {
      required: ai['@_required'] === 'true' || ai['@_required'] === true,
      autoredeploy: 'autoredeploy' in ai,
    };
    if ('autoenable' in ai) {
      const ae = (ai['autoenable'] ?? {}) as Obj;
      autoinstall.autoenable = {
        required: ae['@_required'] === 'true' || ae['@_required'] === true,
      };
    }
  }

  // access_request
  const accessRequest: AccessField[] = [];
  const cdnRequest: string[] = [];
  if ('access_request' in p) {
    const arRaw = p['access_request'];
    // Empty <access_request></access_request> parses as '' or null — treat as no fields
    const ar: Obj = arRaw && typeof arRaw === 'object' ? (arRaw as Obj) : {};
    const fields: unknown[] = Array.isArray(ar['field']) ? ar['field'] : ar['field'] ? [ar['field']] : [];
    for (const f of fields) {
      const fobj = f as Obj;
      accessRequest.push({
        table: asStr(fobj['@_table']) ?? '',
        field: asStr(fobj['@_field']) ?? '',
        access: asStr(fobj['@_access']) ?? 'ViewOnly',
      });
    }
    if (ar['cdn_request'] && typeof ar['cdn_request'] === 'object') {
      const cr = ar['cdn_request'] as Obj;
      const cdns: unknown[] = Array.isArray(cr['cdn']) ? cr['cdn'] : cr['cdn'] ? [cr['cdn']] : [];
      for (const c of cdns) {
        const name = asStr((c as Obj)['@_name']);
        if (name) cdnRequest.push(name);
      }
    }
  }

  // Publisher
  const pub = (p['publisher'] ?? {}) as Obj;
  const contact = (pub['contact'] ?? {}) as Obj;
  const publisher: PluginXmlData['publisher'] = {
    name: asStr(pub['@_name']) ?? '',
    contact: {
      email: asStr(contact['@_email']) ?? '',
      phone: asStr(contact['@_phone']),
    },
  };

  // Links (top-level)
  const links = parseLinks(p['links']);

  // Registration
  let registration: PluginXmlData['registration'];
  if ('registration' in p) {
    const reg = (p['registration'] ?? {}) as Obj;
    registration = { url: asStr(reg['@_url']) ?? '' };
  }

  // OpenID
  let openid: PluginXmlData['openid'];
  if ('openid' in p) {
    const oid = (p['openid'] ?? {}) as Obj;
    openid = {
      host: asStr(oid['@_host']) ?? '',
      port: asStr(oid['@_port']) ?? '',
      links: parseLinks(oid['links']),
    };
  }

  return {
    name: asStr(p['@_name']) ?? '',
    version: asStr(p['@_version']) ?? '',
    description: asStr(p['@_description']) ?? '',
    oauth: hasOauth,
    accessLevelV1Api,
    autoinstall,
    accessRequest,
    cdnRequest,
    publisher,
    links: links.length > 0 ? links : undefined,
    registration,
    openid,
  };
}

export function readPluginXml(filePath: string): PluginXmlData {
  const xml = fs.readFileSync(filePath, 'utf-8');
  return parsePluginXml(xml);
}

// ---- Build -----------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildLinksElement(parent: any, links: PluginLink[]): void {
  const linksEl = parent.ele('links');
  for (const link of links) {
    const linkEl = linksEl.ele('link', {
      title: link.title,
      'display-text': link.displayText,
      path: link.path,
    });
    if (link.uiContextIds.length > 0) {
      const ctxs = linkEl.ele('ui_contexts');
      for (const id of link.uiContextIds) {
        ctxs.ele('ui_context', { id });
      }
    }
  }
}

export function buildPluginXml(data: PluginXmlData): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const plugin = doc.ele('plugin', {
    xmlns: 'http://plugin.powerschool.pearson.com',
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    'xsi:schemaLocation': 'http://plugin.powerschool.pearson.com plugin.xsd',
    name: data.name,
    version: data.version,
    description: data.description,
  });

  // oauth
  if (data.oauth) {
    const oauthAttrs: Record<string, string> = {};
    if (data.accessLevelV1Api && data.accessLevelV1Api !== 'NONE') {
      oauthAttrs['accessLevelV1Api'] = data.accessLevelV1Api;
    }
    plugin.ele('oauth', oauthAttrs);
  }

  // autoinstall
  if (data.autoinstall) {
    const ai = plugin.ele('autoinstall');
    if (data.autoinstall.required) ai.att('required', 'true');
    if (data.autoinstall.autoenable) {
      const ae = ai.ele('autoenable');
      if (data.autoinstall.autoenable.required) ae.att('required', 'true');
    }
    if (data.autoinstall.autoredeploy) ai.ele('autoredeploy');
  }

  // access_request
  const hasAccessRequest =
    data.accessRequest.length > 0 || data.cdnRequest.length > 0 || data.oauth;
  if (hasAccessRequest) {
    const ar = plugin.ele('access_request');
    if (data.cdnRequest.length > 0) {
      const cr = ar.ele('cdn_request');
      for (const cdn of data.cdnRequest) {
        cr.ele('cdn', { name: cdn });
      }
    }
    for (const f of data.accessRequest) {
      ar.ele('field', { table: f.table, field: f.field, access: f.access });
    }
  }

  // publisher
  const pub = plugin.ele('publisher', { name: data.publisher.name });
  const contactAttrs: Record<string, string> = {
    email: data.publisher.contact.email,
  };
  if (data.publisher.contact.phone) {
    contactAttrs['phone'] = data.publisher.contact.phone;
  }
  pub.ele('contact', contactAttrs);

  // registration
  if (data.registration !== undefined) {
    plugin.ele('registration', { url: data.registration.url });
  }

  // openid
  if (data.openid) {
    const oid = plugin.ele('openid', {
      host: data.openid.host,
      port: data.openid.port,
    });
    if (data.openid.links && data.openid.links.length > 0) {
      buildLinksElement(oid, data.openid.links);
    }
  }

  // top-level links
  if (data.links && data.links.length > 0) {
    buildLinksElement(plugin, data.links);
  }

  return doc.end({ prettyPrint: true });
}

export function writePluginXml(filePath: string, data: PluginXmlData): void {
  fs.writeFileSync(filePath, buildPluginXml(data), 'utf-8');
}
