import SwiftUI

/** Export: the sequence as images (to share or save), or posted to Instagram. */
struct ExportView: View {
    @Environment(\.dismiss) private var dismiss
    let store: ProjectStore

    var body: some View {
        NavigationStack {
            Text("Export")
                .navigationTitle("Export")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}
