import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/kernel/errors';
import { buildCsv, csvCell, exportFileName, exportFilter, ExportRow, formatTenge } from './export';

const row: ExportRow = {
  phone: '+77011234567',
  name: 'Асель "Ә"',
  email: 'asel@mail.kz',
  locale: 'kk',
  birthday: null,
  tags: ['vip', 'regular'],
  ordersCount: 3,
  completedOrdersCount: 3,
  totalSpent: { amount: 1_250_050, currency: 'KZT' },
  reservationsCount: 1,
  noShowCount: 0,
  banquetsCount: 0,
  marketingConsent: true,
  firstSeenAt: new Date('2026-09-01T06:00:00Z'),
  lastActivityAt: null,
};

describe('customer export', () => {
  it('marketing export includes only guests with marketing consent', () => {
    expect(exportFilter('marketing', { tags: ['vip'] })).toEqual({ tags: ['vip'], marketingConsent: true });
    expect(() => exportFilter('marketing', { marketingConsent: false })).toThrow(ValidationError);
    expect(exportFilter('service', { marketingConsent: false })).toEqual({ marketingConsent: false });
    expect(exportFilter('service', {})).toEqual({});
  });

  it('formats tenge from tiyn without floats', () => {
    expect(formatTenge(1_250_050)).toBe('12500.50');
    expect(formatTenge(5)).toBe('0.05');
    expect(formatTenge(0)).toBe('0.00');
    expect(formatTenge(-150)).toBe('-1.50');
  });

  it('escapes CSV cells and guards against formula injection', () => {
    expect(csvCell('простой')).toBe('простой');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+77011234567', true)).toBe('+77011234567');
    expect(csvCell('-1')).toBe("'-1");
  });

  it('builds CSV with BOM, header and rows', () => {
    const csv = buildCsv([row], (d) => d.toISOString().slice(0, 10));
    expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = csv.subarray(3).toString('utf8').split('\r\n');
    expect(lines[0]).toContain('Телефон,Имя,Email');
    expect(lines[1]).toBe('+77011234567,"Асель ""Ә""",asel@mail.kz,kk,,"vip, regular",3,3,12500.50,1,0,0,да,2026-09-01,');
    expect(lines[2]).toBe('');
  });

  it('names the file by purpose, format and date', () => {
    expect(exportFileName('marketing', 'xlsx', '2026-10-01')).toBe('aula-customers-marketing-2026-10-01.xlsx');
  });
});
