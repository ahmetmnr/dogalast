import { describe, it, expect } from 'bun:test';

process.env.NODE_ENV = 'development';
process.env.OPENAI_API_KEY = 'test';
process.env.JWT_SECRET = '12345678901234567890123456789012';
process.env.ADMIN_PASSWORD_HASH = 'test';

const { TimingService } = await import('@/services/TimingService');

class FakeDB {
  public inserted: any[] = [];
  insert(_table: any) {
    return {
      values: async (data: any) => {
        this.inserted.push(data);
      },
    };
  }
}

describe('TimingService duplicate event prevention', () => {
  it('records only the first occurrence of an identical event', async () => {
    const db = new FakeDB();
    const service = new TimingService(db as any);
    const event = { sessionQuestionId: 'sq1', eventType: 'tts_start' as const };

    const firstId = await service.markTimingEvent(event);
    const secondId = await service.markTimingEvent(event);

    expect(secondId).toBe(firstId);
    expect(db.inserted.length).toBe(1);
  });
});
