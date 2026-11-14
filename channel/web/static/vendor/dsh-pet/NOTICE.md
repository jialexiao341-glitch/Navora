# Navora browser adaptation

Source: https://github.com/MerZlin/dsh-pet-indesktop/tree/v4.3.4

The 106 original WebM files and character metadata are copied without modification. Their Git blob hashes are checked against the upstream tree during import. Upstream Python behavior and physics modules are retained here for provenance; they are not executed by the browser. The browser host is `js/core/indesktop-pet.js`.

The web adaptation replaces Navora's previous companion configuration entirely and stores its own settings under `navora_indesktop_pet_v1`. It implements the upstream weighted idle/turn/action/movement chain, click and drag clips, throw/bounce, sleep, sizing, roaming and position lock within the browser viewport, plus Navora task animation events. OS-specific tray, multi-monitor, global shortcuts, OCR, native media integrations and the standalone AI chat subsystem are not included in this browser port.

Code: upstream MIT license, preserved in LICENSE. Character artwork/animation: personal noncommercial use, CC BY-NC-SA type terms and attribution as recorded in THIRD_PARTY_NOTICES.md. Original OC by 上善无形; animation source PC2005-cloud/dsh-pet; desktop implementation MerZlin/dsh-pet-indesktop. Retain these notices when redistributing. Do not treat the MIT code license as permission for commercial use of the character assets.
