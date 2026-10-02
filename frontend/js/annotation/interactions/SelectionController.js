export class SelectionController {
    static toggleSelection(selectedIds = [], id) {
        return selectedIds.includes(id) ? selectedIds.filter(item => item !== id) : [...selectedIds, id];
    }
}
