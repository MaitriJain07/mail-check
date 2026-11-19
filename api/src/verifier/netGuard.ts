import net from 'node:net';

/**
 * Anyone can publish an MX record pointing at 127.0.0.1 or a cloud metadata address.
 * Without a guard, SMTP verification becomes a way to make this server open TCP
 * connections to its own internal network (an SSRF-style probe). We refuse those targets.
 */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase();

  if (net.isIPv6(v)) {
    // IPv4-mapped (::ffff:a.b.c.d) → judge the embedded IPv4 address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateAddress(mapped[1] as string);
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1] as string, 16);
      const lo = parseInt(mappedHex[2] as string, 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return (
      v === '::' ||
      v === '::1' ||
      v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || // fe80::/10 link-local
      v.startsWith('fc') || v.startsWith('fd') // fc00::/7 unique local
    );
  }

  if (!net.isIPv4(v)) return true; // unparseable: refuse rather than guess
  const [a, b] = v.split('.').map(Number) as [number, number];
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // 192.0.0.0/24 IETF protocol assignments
    a >= 224 // multicast + reserved
  );
}
