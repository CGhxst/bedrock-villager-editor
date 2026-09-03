# Bedrock Villager Editor

> **NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.**

An unofficial desktop application and CLI tool for Minecraft: Bedrock Edition villager trades, professions, career tiers, enchantments, positions, and linked workstations.

---

## Quick Start (Desktop Application)

The primary interface for editing Bedrock villagers is the native Electron desktop application.

```bash
cd VillagerEditor
npm install
npm start
```
*(or run `Launch-Villager-Editor.bat` on Windows)*

### Features
- **Auto-Detect Worlds**: Automatically detects Bedrock worlds across UWP and roaming directories.
- **Read-Only Villager World Map**: Overhead biome-colored terrain map of generated Bedrock chunks with Overworld/Nether/End dimension switching and clickable villager selection markers.
- **JSON Export and Import**: Export villager data and trades to an editable, schema-validated JSON file, modify in any text editor, and re-import with transactional undo/redo safety.
- **Transactional Session**: Multi-step Undo (`Ctrl+Z`) and Redo (`Ctrl+Y`) for all operations.
- **Granular Leaf Trade Patching**: Updates only modified trade fields without rewriting untouched recipes or sibling NBT tags.
- **Item Picker and Enchantment Catalog**: Curated common item picker, manual entry for custom namespaced item IDs, and built-in Bedrock enchantment catalog with numeric IDs (0-41) and level bounds.
- **Semantic Bulk Operations**:
  - **Set All Costs to 1**: Modifies cost quantities without affecting max stock or traded uses.
  - **Reset Uses to 0 (Restock)**: Resets traded counts to unlock trades immediately.
  - **Set Max Stock (9999)**: Configures high maximum uses.
- **Patch-Oriented NBT Preservation**: Preserves raw NBT encoding (`little`, `littleVarint`, 4-byte prefixes) and unknown entity and recipe tags with SHA-256 conflict checks and format-preserving writes.
- **Atomic Rollback, Backups, and Staged Restore**: Pre-save zip backups, atomic directory replacement, and automatic rollback on save failure. Restore extracts and validates LevelDB databases before replacing the live world.
- **Inspection-Only Raw NBT**: High-privilege raw NBT is available for read-only inspection without exposing arbitrary client mutation.

---

## Important Usage Notes

- **Workstation and Bed Links:** The Links tab displays villager-linked workstation and bed information for inspection only. This tool does not modify workstation or bed links and does not discover, place, verify, unlink, or manually assign workstation/bed coordinates.
- **World Map Terrain:** The map is a read-only stylized biome-colored terrain preview derived from generated Bedrock chunk height and biome data with elevation shading, not a block-texture-perfect world renderer. Missing terrain chunks remain blank while unavailable biome data falls back to dimension colors; villager markers remain available independently of terrain rendering.
- **JSON Export and Import:** JSON exchange uses opaque villager and trade identities. Existing trade re-import preserves granular NBT patching without rewriting untouched recipes or tags. Legacy JSON exports without stable trade IDs cannot re-import trade arrays and must be re-exported with the current editor. GUI JSON import modifies only the in-memory session until an explicit Save Review and Save.
- **World Safety:** Always test editor updates on a copy of an important world before modifying primary saves. Never write directly to your only copy of a Minecraft world.

---

## CLI Commands

### 1. List Detected Worlds
```bash
npm run build
node bin/villager-editor.js list
```

### 2. Export Villagers to JSON
```bash
node bin/villager-editor.js export "C:\Path\To\BedrockWorld" -o villagers_export.json
```

### 3. Import Edited Villagers from JSON
```bash
node bin/villager-editor.js import "C:\Path\To\BedrockWorld" villagers_export.json
```

### 4. Dump World Villagers to JSON (Diagnostic Raw Export)
```bash
node bin/villager-editor.js dump "C:\Path\To\BedrockWorld" -o villagers_dump.json
```

### 5. Batch World Discount (Transactional Session)
Discount trade cost quantities across a world with automated backup:
```bash
node bin/villager-editor.js discount "C:\Path\To\BedrockWorld" --reset-uses
```

---

## Distribution

- **Source Development:** `npm install` and `npm start`
- **Local Unsigned Windows Packaging:** `npm run make:win`
- **Stable Signed Windows Release:** `npm run make:win:signed`
- **Signing Secret Safety:** Keep the Windows signing certificate outside the project repository. Set `WINDOWS_CERTIFICATE_FILE` to that external path and provide the password only through `WINDOWS_CERTIFICATE_PASSWORD`.
- **Code Signing:** Stable Windows release packages must be Authenticode-signed and timestamped, and both signatures must be verified on the release machine before publication.
- **Stable Release Verification:** `npm run release:verify:stable`
- **World Validation:** Test important worlds only through copies during validation.

---

## Experimental Software and Limitation of Liability

> **DISCLAIMER:** Bedrock Villager Editor is experimental community software that directly interacts with and modifies binary Minecraft LevelDB and NBT save files.
>
> **ALWAYS BACK UP YOUR WORLDS** before opening or editing them with this tool. Never modify your only copy of a Minecraft world.
>
> This software is provided "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR CONTRIBUTORS BE LIABLE FOR ANY CLAIM, DAMAGES, CORRUPTION, LOSS OF SAVES, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

## Unofficial Project Notice

> **NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.**

---

## Safety and Reliability
All LevelDB writes are protected by a SHA-256 conflict detection journal, pre-save backup creation, byte-level post-save verification, semantic state re-parsing, and automatic failure rollback.

