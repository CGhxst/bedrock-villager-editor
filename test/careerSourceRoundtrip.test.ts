import { describe, it } from "node:test";
import assert from "node:assert";
import { parseVillagerNbt } from "../src/core/villagerParser";
import { writeVillagerToNbt } from "../src/core/villagerWriter";
import { NbtTags, parseBedrockNbt, writeBedrockNbt } from "../src/core/nbtHelper";
import { CareerLevelSource, ParsedVillager } from "../src/core/types";

describe("CareerLevelSource Binary Byte Roundtrip Matrix", () => {
  const sources: Array<{
    source: CareerLevelSource;
    buildNbt: (tier: number) => any;
    assertPreserved: (nbt: any, expectedTier: number) => void;
  }> = [
    {
      source: "root:CareerLevel",
      buildNbt: (tier) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          CareerLevel: NbtTags.int(tier),
          SentinelUnknownTag: NbtTags.int(888)
        }
      }),
      assertPreserved: (nbt, expectedTier) => {
        assert.strictEqual(nbt.value.CareerLevel.value, expectedTier);
        assert.strictEqual(nbt.value.careerLevel, undefined);
        assert.strictEqual(nbt.value.TradeTier, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 888);
      }
    },
    {
      source: "root:careerLevel",
      buildNbt: (tier) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          careerLevel: NbtTags.int(tier),
          SentinelUnknownTag: NbtTags.int(888)
        }
      }),
      assertPreserved: (nbt, expectedTier) => {
        assert.strictEqual(nbt.value.careerLevel.value, expectedTier);
        assert.strictEqual(nbt.value.CareerLevel, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 888);
      }
    },
    {
      source: "root:TradeTier",
      buildNbt: (tier) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          TradeTier: NbtTags.int(tier),
          SentinelUnknownTag: NbtTags.int(888)
        }
      }),
      assertPreserved: (nbt, expectedTier) => {
        assert.strictEqual(nbt.value.TradeTier.value, expectedTier);
        assert.strictEqual(nbt.value.CareerLevel, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 888);
      }
    },
    {
      source: "root:tradeTier",
      buildNbt: (tier) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          tradeTier: NbtTags.int(tier),
          SentinelUnknownTag: NbtTags.int(888)
        }
      }),
      assertPreserved: (nbt, expectedTier) => {
        assert.strictEqual(nbt.value.tradeTier.value, expectedTier);
        assert.strictEqual(nbt.value.CareerLevel, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 888);
      }
    },
    {
      source: "root:CareerTier",
      buildNbt: (tier) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          CareerTier: NbtTags.int(tier),
          SentinelUnknownTag: NbtTags.int(888)
        }
      }),
      assertPreserved: (nbt, expectedTier) => {
        assert.strictEqual(nbt.value.CareerTier.value, expectedTier);
        assert.strictEqual(nbt.value.CareerLevel, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 888);
      }
    },
    {
      source: "root:careerTier",
      buildNbt: (tier) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          careerTier: NbtTags.int(tier),
          SentinelUnknownTag: NbtTags.int(888)
        }
      }),
      assertPreserved: (nbt, expectedTier) => {
        assert.strictEqual(nbt.value.careerTier.value, expectedTier);
        assert.strictEqual(nbt.value.CareerLevel, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 888);
      }
    },
    {
      source: "root:Tier",
      buildNbt: (tier) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          Tier: NbtTags.int(tier),
          SentinelUnknownTag: NbtTags.int(888)
        }
      }),
      assertPreserved: (nbt, expectedTier) => {
        assert.strictEqual(nbt.value.Tier.value, expectedTier);
        assert.strictEqual(nbt.value.CareerLevel, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 888);
      }
    },
    {
      source: "root:tier",
      buildNbt: (tier) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          tier: NbtTags.int(tier),
          SentinelUnknownTag: NbtTags.int(888)
        }
      }),
      assertPreserved: (nbt, expectedTier) => {
        assert.strictEqual(nbt.value.tier.value, expectedTier);
        assert.strictEqual(nbt.value.CareerLevel, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 888);
      }
    },
    {
      source: "offers:Tier",
      buildNbt: (tier) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          Offers: {
            type: "compound",
            value: {
              Tier: NbtTags.int(tier)
            }
          },
          SentinelUnknownTag: NbtTags.int(888)
        }
      }),
      assertPreserved: (nbt, expectedTier) => {
        assert.strictEqual(nbt.value.Offers.value.Tier.value, expectedTier);
        assert.strictEqual(nbt.value.CareerLevel, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 888);
      }
    },
    {
      source: "offers:tier",
      buildNbt: (tier) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          Offers: {
            type: "compound",
            value: {
              tier: NbtTags.int(tier)
            }
          },
          SentinelUnknownTag: NbtTags.int(888)
        }
      }),
      assertPreserved: (nbt, expectedTier) => {
        assert.strictEqual(nbt.value.Offers.value.tier.value, expectedTier);
        assert.strictEqual(nbt.value.CareerLevel, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 888);
      }
    },
    {
      source: "offers:CareerLevel",
      buildNbt: (tier) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          Offers: {
            type: "compound",
            value: {
              CareerLevel: NbtTags.int(tier)
            }
          },
          SentinelUnknownTag: NbtTags.int(888)
        }
      }),
      assertPreserved: (nbt, expectedTier) => {
        assert.strictEqual(nbt.value.Offers.value.CareerLevel.value, expectedTier);
        assert.strictEqual(nbt.value.CareerLevel, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 888);
      }
    },
    {
      source: "offers:careerLevel",
      buildNbt: (tier) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          Offers: {
            type: "compound",
            value: {
              careerLevel: NbtTags.int(tier)
            }
          },
          SentinelUnknownTag: NbtTags.int(888)
        }
      }),
      assertPreserved: (nbt, expectedTier) => {
        assert.strictEqual(nbt.value.Offers.value.careerLevel.value, expectedTier);
        assert.strictEqual(nbt.value.CareerLevel, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 888);
      }
    },
    {
      source: "offers:TradeTier",
      buildNbt: (tier) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          Offers: {
            type: "compound",
            value: {
              TradeTier: NbtTags.int(tier)
            }
          },
          SentinelUnknownTag: NbtTags.int(888)
        }
      }),
      assertPreserved: (nbt, expectedTier) => {
        assert.strictEqual(nbt.value.Offers.value.TradeTier.value, expectedTier);
        assert.strictEqual(nbt.value.CareerLevel, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 888);
      }
    },
    {
      source: "offers:tradeTier",
      buildNbt: (tier) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          Offers: {
            type: "compound",
            value: {
              tradeTier: NbtTags.int(tier)
            }
          },
          SentinelUnknownTag: NbtTags.int(888)
        }
      }),
      assertPreserved: (nbt, expectedTier) => {
        assert.strictEqual(nbt.value.Offers.value.tradeTier.value, expectedTier);
        assert.strictEqual(nbt.value.CareerLevel, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 888);
      }
    },
    {
      source: "offers:CareerTier",
      buildNbt: (tier) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          Offers: {
            type: "compound",
            value: {
              CareerTier: NbtTags.int(tier)
            }
          },
          SentinelUnknownTag: NbtTags.int(888)
        }
      }),
      assertPreserved: (nbt, expectedTier) => {
        assert.strictEqual(nbt.value.Offers.value.CareerTier.value, expectedTier);
        assert.strictEqual(nbt.value.CareerLevel, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 888);
      }
    },
    {
      source: "offers:careerTier",
      buildNbt: (tier) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          Offers: {
            type: "compound",
            value: {
              careerTier: NbtTags.int(tier)
            }
          },
          SentinelUnknownTag: NbtTags.int(888)
        }
      }),
      assertPreserved: (nbt, expectedTier) => {
        assert.strictEqual(nbt.value.Offers.value.careerTier.value, expectedTier);
        assert.strictEqual(nbt.value.CareerLevel, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 888);
      }
    },
    {
      source: "offers:MaxTier",
      buildNbt: (tier) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          Offers: {
            type: "compound",
            value: {
              MaxTier: NbtTags.int(tier)
            }
          },
          SentinelUnknownTag: NbtTags.int(888)
        }
      }),
      assertPreserved: (nbt, expectedTier) => {
        assert.strictEqual(nbt.value.Offers.value.MaxTier.value, expectedTier);
        assert.strictEqual(nbt.value.CareerLevel, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 888);
      }
    },
    {
      source: "offers:maxTier",
      buildNbt: (tier) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          Offers: {
            type: "compound",
            value: {
              maxTier: NbtTags.int(tier)
            }
          },
          SentinelUnknownTag: NbtTags.int(888)
        }
      }),
      assertPreserved: (nbt, expectedTier) => {
        assert.strictEqual(nbt.value.Offers.value.maxTier.value, expectedTier);
        assert.strictEqual(nbt.value.CareerLevel, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 888);
      }
    },
    {
      source: "definitions",
      buildNbt: (tier) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          definitions: NbtTags.list("string", [`+minecraft:level=${tier}`, "+minecraft:biome=plains"]),
          SentinelUnknownTag: NbtTags.int(888)
        }
      }),
      assertPreserved: (nbt, expectedTier) => {
        const defs = nbt.value.definitions.value.value;
        assert.ok(defs.some((d: string) => d === `+minecraft:level=${expectedTier}`));
        assert.ok(defs.some((d: string) => d === "+minecraft:biome=plains"));
        assert.strictEqual(nbt.value.CareerLevel, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 888);
      }
    }
  ];

  for (const item of sources) {
    it(`correctly binary roundtrips and mutates career level via ${item.source} without creating phantom tags`, async () => {
      // 1. Build initial raw compound (Novice, tier=1) and encode to binary Bedrock NBT
      const initialNbt = item.buildNbt(1);
      const initialBytes = writeBedrockNbt(initialNbt, "little");

      // 2. Parse from binary bytes
      const parsedStorage = await parseBedrockNbt(initialBytes);
      const parsed = parseVillagerNbt(parsedStorage.parsed, "00112233445566778899aabbccddeeff", 0);
      assert.ok(parsed);
      assert.strictEqual(parsed.careerLevel, 1);
      assert.strictEqual(parsed.careerLevelSource, item.source);

      // 3. Change career level to Master (tier=5)
      const edited: ParsedVillager = {
        ...parsed,
        careerLevel: 5
      };

      const updatedNbt = writeVillagerToNbt(edited, parsed);
      item.assertPreserved(updatedNbt, 5);

      // 4. Encode updated NBT to binary Bedrock NBT bytes
      const updatedBytes = writeBedrockNbt(updatedNbt, "little");

      // 5. Re-parse binary bytes and assert semantic and source symmetry
      const reparsedStorage = await parseBedrockNbt(updatedBytes);
      const reparsed = parseVillagerNbt(reparsedStorage.parsed, "00112233445566778899aabbccddeeff", 0);
      assert.ok(reparsed);
      assert.strictEqual(reparsed.careerLevel, 5);
      assert.strictEqual(reparsed.careerLevelSource, item.source);
      item.assertPreserved(reparsedStorage.parsed, 5);
    });
  }
});

describe("Auxiliary TradeTier Synchronization Tests", () => {
  it("career edit synchronizes existing root/offers TradeTier aliases without synthesizing absent aliases", async () => {
    const rawNbt = {
      type: "compound",
      name: "",
      value: {
        identifier: NbtTags.string("minecraft:villager_v2"),
        CareerLevel: NbtTags.short(2),
        TradeTier: NbtTags.byte(2),
        tradeTier: NbtTags.int(2),
        Offers: {
          type: "compound",
          value: {
            TradeTier: NbtTags.short(2),
            tradeTier: NbtTags.byte(2),
            SentinelOffersSibling: NbtTags.string("keep-offers")
          }
        },
        SentinelUnknownTag: NbtTags.int(888)
      }
    };

    const initialBytes = writeBedrockNbt(rawNbt, "little");
    const parsedStorage = await parseBedrockNbt(initialBytes);
    const parsed = parseVillagerNbt(parsedStorage.parsed, "00112233445566778899aabbccddeeff", 0);

    assert.ok(parsed);
    assert.strictEqual(parsed.careerLevel, 2);
    assert.strictEqual(parsed.careerLevelSource, "root:CareerLevel");

    const edited: ParsedVillager = {
      ...parsed,
      careerLevel: 4
    };

    const updatedNbt = writeVillagerToNbt(edited, parsed);
    const val = updatedNbt.value || updatedNbt;

    assert.strictEqual(val.CareerLevel.value, 4);
    assert.strictEqual(val.CareerLevel.type, "short");
    assert.strictEqual(val.TradeTier.value, 4);
    assert.strictEqual(val.TradeTier.type, "byte");
    assert.strictEqual(val.tradeTier.value, 4);
    assert.strictEqual(val.tradeTier.type, "int");

    const offersVal = val.Offers.value || val.Offers;
    assert.strictEqual(offersVal.TradeTier.value, 4);
    assert.strictEqual(offersVal.TradeTier.type, "short");
    assert.strictEqual(offersVal.tradeTier.value, 4);
    assert.strictEqual(offersVal.tradeTier.type, "byte");
    assert.strictEqual(offersVal.SentinelOffersSibling.value, "keep-offers");
    assert.strictEqual(val.SentinelUnknownTag.value, 888);

    // Absent aliases not synthesized
    assert.strictEqual(val.CareerTier, undefined);
    assert.strictEqual(val.Tier, undefined);
    assert.strictEqual(offersVal.CareerLevel, undefined);
    assert.strictEqual(offersVal.Tier, undefined);

    // Binary encode & reparse
    const updatedBytes = writeBedrockNbt(updatedNbt, "little");
    const reparsedStorage = await parseBedrockNbt(updatedBytes);
    const repVal = reparsedStorage.parsed.value || reparsedStorage.parsed;

    assert.strictEqual(repVal.CareerLevel.value, 4);
    assert.strictEqual(repVal.CareerLevel.type, "short");
    assert.strictEqual(repVal.TradeTier.value, 4);
    assert.strictEqual(repVal.TradeTier.type, "byte");
    assert.strictEqual(repVal.tradeTier.value, 4);
    assert.strictEqual(repVal.tradeTier.type, "int");

    const repOffersVal = repVal.Offers.value || repVal.Offers;
    assert.strictEqual(repOffersVal.TradeTier.value, 4);
    assert.strictEqual(repOffersVal.TradeTier.type, "short");
    assert.strictEqual(repOffersVal.tradeTier.value, 4);
    assert.strictEqual(repOffersVal.tradeTier.type, "byte");
    assert.strictEqual(repOffersVal.SentinelOffersSibling.value, "keep-offers");
    assert.strictEqual(repVal.SentinelUnknownTag.value, 888);

    assert.strictEqual(repVal.CareerTier, undefined);
    assert.strictEqual(repVal.Tier, undefined);
    assert.strictEqual(repOffersVal.CareerLevel, undefined);
    assert.strictEqual(repOffersVal.Tier, undefined);
  });

  it("unrelated villager edit does not synchronize or rewrite differing TradeTier aliases", async () => {
    const rawNbt = {
      type: "compound",
      name: "",
      value: {
        identifier: NbtTags.string("minecraft:villager_v2"),
        CareerLevel: NbtTags.short(2),
        TradeTier: NbtTags.byte(4),
        Offers: {
          type: "compound",
          value: {
            TradeTier: NbtTags.short(5)
          }
        },
        SentinelUnknownTag: NbtTags.int(999)
      }
    };

    const initialBytes = writeBedrockNbt(rawNbt, "little");
    const parsedStorage = await parseBedrockNbt(initialBytes);
    const parsed = parseVillagerNbt(parsedStorage.parsed, "00112233445566778899aabbccddeeff", 0);
    assert.ok(parsed);

    const edited: ParsedVillager = {
      ...parsed,
      customName: "New Custom Name"
    };

    const updatedNbt = writeVillagerToNbt(edited, parsed);
    const val = updatedNbt.value || updatedNbt;

    assert.strictEqual(val.CareerLevel.value, 2);
    assert.strictEqual(val.CareerLevel.type, "short");
    assert.strictEqual(val.TradeTier.value, 4);
    assert.strictEqual(val.TradeTier.type, "byte");

    const offersVal = val.Offers.value || val.Offers;
    assert.strictEqual(offersVal.TradeTier.value, 5);
    assert.strictEqual(offersVal.TradeTier.type, "short");

    assert.strictEqual(val.CustomName.value, "New Custom Name");
    assert.strictEqual(val.SentinelUnknownTag.value, 999);
  });
});

