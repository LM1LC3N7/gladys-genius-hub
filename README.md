# gladys-genius-hub

Gladys Assistant external integration for **Genius Hub** (Heat Genius)
heating: the zones of the house (radiator rooms, wet underfloor, hot water,
on/off timers) with their temperature, setpoint, modes, heat demand and
issues, and the devices behind the hub (radiator valves, thermostats, plugs,
sensors), read through the **local API v3** of the hub (port 1223, no cloud).
From Gladys: a setpoint (an override for a configured duration), the modes,
the hot water, an on/off zone. Setpoint and mode commands are off by default;
"Off" needs no option.

Unofficial, not affiliated with Genius Hub. **Never tested with a real Genius
Hub**: built from the public documentation and
[geniushub-client](https://github.com/manzanotti/geniushub-client) (MIT, see
`THIRD_PARTY_NOTICES.md`), the library of Home Assistant.

- Guide: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md)
- Status, decisions, what to check on a real hub: [TODO.md](TODO.md)
- Rules for contributors and coding assistants: [CLAUDE.md](CLAUDE.md)

## Development

```bash
npm install
npm test                 # node --test
npm run lint             # ESLint
npm run format:check     # Prettier
npm run audit            # npm audit --omit=dev
npm run cover            # regenerates cover.png (plain Node)
```

The tests run against the fake Gladys of the SDK, a scripted hub and a
virtual clock (`test/helpers/`), plus one test on the real clock against a
local HTTP server (`test/realclock.test.js`). Nothing touches the network.

## License

Apache-2.0 (`LICENSE`). Ported logic: `THIRD_PARTY_NOTICES.md`.
