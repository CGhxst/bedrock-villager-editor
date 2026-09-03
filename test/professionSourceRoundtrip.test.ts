import { describe, it } from "node:test";
import assert from "node:assert";
import { parseVillagerNbt } from "../src/core/villagerParser";
import { writeVillagerToNbt } from "../src/core/villagerWriter";
import { NbtTags, parseBedrockNbt, writeBedrockNbt } from "../src/core/nbtHelper";
import { ParsedVillager, ProfessionSource } from "../src/core/types";

describe("ProfessionSource Binary Byte Roundtrip Matrix", () => {
  const sources: Array<{
    source: ProfessionSource;
    buildNbt: (profId: number, profName: string) => any;
    assertPreserved: (nbt: any, expectedName: string, expectedId: number) => void;
  }> = [
    {
      source: "root:Profession",
      buildNbt: (profId) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          Profession: NbtTags.int(profId),
          SentinelUnknownTag: NbtTags.int(999)
        }
      }),
      assertPreserved: (nbt, _, expectedId) => {
        assert.strictEqual(nbt.value.Profession.value, expectedId);
        assert.strictEqual(nbt.value.profession, undefined);
        assert.strictEqual(nbt.value.Career, undefined);
        assert.strictEqual(nbt.value.Definitions, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 999);
      }
    },
    {
      source: "root:profession",
      buildNbt: (profId) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          profession: NbtTags.int(profId),
          SentinelUnknownTag: NbtTags.int(999)
        }
      }),
      assertPreserved: (nbt, _, expectedId) => {
        assert.strictEqual(nbt.value.profession.value, expectedId);
        assert.strictEqual(nbt.value.Profession, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 999);
      }
    },
    {
      source: "root:ProfessionName",
      buildNbt: (_, profName) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          ProfessionName: NbtTags.string(`minecraft:${profName}`),
          SentinelUnknownTag: NbtTags.int(999)
        }
      }),
      assertPreserved: (nbt, expectedName) => {
        assert.strictEqual(nbt.value.ProfessionName.value, `minecraft:${expectedName}`);
        assert.strictEqual(nbt.value.Profession, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 999);
      }
    },
    {
      source: "root:professionName",
      buildNbt: (_, profName) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          professionName: NbtTags.string(`minecraft:${profName}`),
          SentinelUnknownTag: NbtTags.int(999)
        }
      }),
      assertPreserved: (nbt, expectedName) => {
        assert.strictEqual(nbt.value.professionName.value, `minecraft:${expectedName}`);
        assert.strictEqual(nbt.value.Profession, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 999);
      }
    },
    {
      source: "root:Career",
      buildNbt: (profId) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          Career: NbtTags.int(profId),
          SentinelUnknownTag: NbtTags.int(999)
        }
      }),
      assertPreserved: (nbt, _, expectedId) => {
        assert.strictEqual(nbt.value.Career.value, expectedId);
        assert.strictEqual(nbt.value.Profession, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 999);
      }
    },
    {
      source: "root:career",
      buildNbt: (profId) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          career: NbtTags.int(profId),
          SentinelUnknownTag: NbtTags.int(999)
        }
      }),
      assertPreserved: (nbt, _, expectedId) => {
        assert.strictEqual(nbt.value.career.value, expectedId);
        assert.strictEqual(nbt.value.Profession, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 999);
      }
    },
    {
      source: "root:PreferredProfession",
      buildNbt: (_, profName) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          PreferredProfession: NbtTags.string(`minecraft:${profName}`),
          SentinelUnknownTag: NbtTags.int(999)
        }
      }),
      assertPreserved: (nbt, expectedName) => {
        assert.strictEqual(nbt.value.PreferredProfession.value, `minecraft:${expectedName}`);
        assert.strictEqual(nbt.value.Profession, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 999);
      }
    },
    {
      source: "root:preferredProfession",
      buildNbt: (_, profName) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          preferredProfession: NbtTags.string(`minecraft:${profName}`),
          SentinelUnknownTag: NbtTags.int(999)
        }
      }),
      assertPreserved: (nbt, expectedName) => {
        assert.strictEqual(nbt.value.preferredProfession.value, `minecraft:${expectedName}`);
        assert.strictEqual(nbt.value.Profession, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 999);
      }
    },
    {
      source: "offers:Profession",
      buildNbt: (profId) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          Offers: {
            type: "compound",
            value: {
              Profession: NbtTags.int(profId)
            }
          },
          SentinelUnknownTag: NbtTags.int(999)
        }
      }),
      assertPreserved: (nbt, _, expectedId) => {
        assert.strictEqual(nbt.value.Offers.value.Profession.value, expectedId);
        assert.strictEqual(nbt.value.Profession, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 999);
      }
    },
    {
      source: "offers:profession",
      buildNbt: (profId) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          Offers: {
            type: "compound",
            value: {
              profession: NbtTags.int(profId)
            }
          },
          SentinelUnknownTag: NbtTags.int(999)
        }
      }),
      assertPreserved: (nbt, _, expectedId) => {
        assert.strictEqual(nbt.value.Offers.value.profession.value, expectedId);
        assert.strictEqual(nbt.value.Profession, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 999);
      }
    },
    {
      source: "offers:Career",
      buildNbt: (profId) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          Offers: {
            type: "compound",
            value: {
              Career: NbtTags.int(profId)
            }
          },
          SentinelUnknownTag: NbtTags.int(999)
        }
      }),
      assertPreserved: (nbt, _, expectedId) => {
        assert.strictEqual(nbt.value.Offers.value.Career.value, expectedId);
        assert.strictEqual(nbt.value.Profession, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 999);
      }
    },
    {
      source: "offers:career",
      buildNbt: (profId) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          Offers: {
            type: "compound",
            value: {
              career: NbtTags.int(profId)
            }
          },
          SentinelUnknownTag: NbtTags.int(999)
        }
      }),
      assertPreserved: (nbt, _, expectedId) => {
        assert.strictEqual(nbt.value.Offers.value.career.value, expectedId);
        assert.strictEqual(nbt.value.Profession, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 999);
      }
    },
    {
      source: "Definitions",
      buildNbt: (_, profName) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          Definitions: NbtTags.list("string", [`+minecraft:profession=${profName}`, "+minecraft:biome=plains"]),
          SentinelUnknownTag: NbtTags.int(999)
        }
      }),
      assertPreserved: (nbt, expectedName) => {
        const defs = nbt.value.Definitions.value.value;
        assert.ok(defs.some((d: string) => d === `+minecraft:profession=${expectedName}`));
        assert.ok(defs.some((d: string) => d === "+minecraft:biome=plains"));
        assert.strictEqual(nbt.value.definitions, undefined);
        assert.strictEqual(nbt.value.Profession, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 999);
      }
    },
    {
      source: "definitions",
      buildNbt: (_, profName) => ({
        type: "compound",
        name: "",
        value: {
          identifier: NbtTags.string("minecraft:villager_v2"),
          definitions: NbtTags.list("string", [`+minecraft:profession=${profName}`, "+minecraft:biome=plains"]),
          SentinelUnknownTag: NbtTags.int(999)
        }
      }),
      assertPreserved: (nbt, expectedName) => {
        const defs = nbt.value.definitions.value.value;
        assert.ok(defs.some((d: string) => d === `+minecraft:profession=${expectedName}`));
        assert.ok(defs.some((d: string) => d === "+minecraft:biome=plains"));
        assert.strictEqual(nbt.value.Definitions, undefined);
        assert.strictEqual(nbt.value.Profession, undefined);
        assert.strictEqual(nbt.value.SentinelUnknownTag.value, 999);
      }
    }
  ];

  for (const item of sources) {
    it(`correctly binary roundtrips and mutates profession via ${item.source} without creating phantom tags`, async () => {
      // 1. Build initial raw compound (Farmer, id=1, name="farmer") and encode to binary Bedrock NBT
      const initialNbt = item.buildNbt(1, "farmer");
      const initialBytes = writeBedrockNbt(initialNbt, "little");

      // 2. Parse from binary bytes
      const parsedStorage = await parseBedrockNbt(initialBytes);
      const parsed = parseVillagerNbt(parsedStorage.parsed, "00112233445566778899aabbccddeeff", 0);
      assert.ok(parsed);
      assert.strictEqual(parsed.profession, "farmer");
      assert.strictEqual(parsed.professionSource, item.source);

      // 3. Change profession to Librarian (numeric id=5, name="librarian")
      const edited: ParsedVillager = {
        ...parsed,
        profession: "librarian",
        professionDisplayName: "Librarian"
      };

      const updatedNbt = writeVillagerToNbt(edited, parsed);
      item.assertPreserved(updatedNbt, "librarian", 5);

      // 4. Encode updated NBT to binary Bedrock NBT bytes
      const updatedBytes = writeBedrockNbt(updatedNbt, "little");

      // 5. Re-parse binary bytes and assert semantic and source symmetry
      const reparsedStorage = await parseBedrockNbt(updatedBytes);
      const reparsed = parseVillagerNbt(reparsedStorage.parsed, "00112233445566778899aabbccddeeff", 0);
      assert.ok(reparsed);
      assert.strictEqual(reparsed.profession, "librarian");
      assert.strictEqual(reparsed.professionSource, item.source);
      item.assertPreserved(reparsedStorage.parsed, "librarian", 5);
    });
  }
});
