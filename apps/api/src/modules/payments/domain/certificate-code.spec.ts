import { describe, expect, it } from 'vitest';
import { UNAMBIGUOUS_ALPHABET } from '../../../shared/kernel/random';
import {
  certificateCodeLast4,
  formatCertificateCode,
  generateCertificateCode,
  maskCertificateCode,
  normalizeCertificateCode,
} from './certificate-code';

describe('certificate code', () => {
  it('generates XXXX-XXXX-XXXX from the unambiguous alphabet', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = generateCertificateCode();
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      for (const ch of code.replace(/-/g, '')) expect(UNAMBIGUOUS_ALPHABET).toContain(ch);
      codes.add(code);
    }
    expect(codes.size).toBe(200);
  });

  it('normalizes user input', () => {
    expect(normalizeCertificateCode(' abcd-efgh-jkmn ')).toBe('ABCDEFGHJKMN');
    expect(normalizeCertificateCode('ABCD EFGH JKMN')).toBe('ABCDEFGHJKMN');
    expect(normalizeCertificateCode('ABCD-EFGH-JKM')).toBeNull();
    // Похожие символы (0, O, 1, I, L) в алфавит не входят.
    expect(normalizeCertificateCode('ABCD-EFGH-JK0N')).toBeNull();
    expect(normalizeCertificateCode('ABCD-EFGH-JKON')).toBeNull();
    expect(normalizeCertificateCode(null)).toBeNull();
  });

  it('formats and masks', () => {
    expect(formatCertificateCode('ABCDEFGHJKMN')).toBe('ABCD-EFGH-JKMN');
    expect(certificateCodeLast4('ABCDEFGHJKMN')).toBe('JKMN');
    expect(maskCertificateCode('JKMN')).toBe('****-****-JKMN');
  });
});
