/**
 * Der Ausweis eines Agents. Riskant ist nicht das Lesen eines guten Headers,
 * sondern alles, was fast einer ist: Jede unklare Form muss `null` ergeben —
 * also 401 —, nie eine halbe Identitaet.
 */

import { describe, expect, it } from 'vitest';
import { credentialsFrom } from '../src/credentials';

const basic = (value: string): string => `Basic ${Buffer.from(value).toString('base64')}`;

describe('credentialsFrom', () => {
  it('liest das Bearer-Token aus create_agent', () => {
    expect(credentialsFrom('Bearer oac_abc.geheim-_x')).toEqual({
      id: 'oac_abc',
      secret: 'geheim-_x',
    });
    // Das Schema ist nicht gross-/kleinschreibungsabhaengig (RFC 7235).
    expect(credentialsFrom('bearer oac_abc.geheim')).toEqual({ id: 'oac_abc', secret: 'geheim' });
  });

  it('liest weiterhin Basic', () => {
    expect(credentialsFrom(basic('oac_abc:geheim'))).toEqual({ id: 'oac_abc', secret: 'geheim' });
    // Ein Doppelpunkt im Secret gehoert zum Secret.
    expect(credentialsFrom(basic('oac_abc:ge:heim'))).toEqual({ id: 'oac_abc', secret: 'ge:heim' });
  });

  it('gibt bei allem Unklaren null zurueck', () => {
    for (const header of [
      undefined,
      '',
      'Bearer',
      'Bearer ',
      'Bearer ohnepunkt',
      'Bearer .nursecret',
      'Bearer nurid.',
      basic('ohnedoppelpunkt'),
      basic(':nursecret'),
      basic('nurid:'),
      'Digest oac_abc.geheim',
      'oac_abc.geheim',
    ]) {
      expect(credentialsFrom(header), String(header)).toBeNull();
    }
  });
});
