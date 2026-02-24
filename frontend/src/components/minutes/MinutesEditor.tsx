import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type FC,
    type ReactNode,
} from "react";
import {
    BaseEditor,
    createEditor,
    Descendant,
    Editor,
    Element as SlateElement,
    Node,
    Transforms,
} from "slate";
import { Editable, Slate, withReact, useSlate, ReactEditor } from "slate-react";
import { jsPDF } from "jspdf";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import {
    Bold,
    Italic,
    List,
    ListOrdered,
    Heading1,
    Heading2,
    FileDown,
    Save,
    AlertTriangle,
} from "lucide-react";

type CustomText = { text: string; bold?: boolean; italic?: boolean };
type ParagraphElement = { type: "paragraph"; children: CustomText[] };
type HeadingOneElement = { type: "heading-one"; children: CustomText[] };
type HeadingTwoElement = { type: "heading-two"; children: CustomText[] };
type BulletedListElement = { type: "bulleted-list"; children: ListItemElement[] };
type NumberedListElement = { type: "numbered-list"; children: ListItemElement[] };
type ListItemElement = { type: "list-item"; children: CustomText[] };
type CustomElement =
    | ParagraphElement
    | HeadingOneElement
    | HeadingTwoElement
    | BulletedListElement
    | NumberedListElement
    | ListItemElement;

declare module "slate" {
    interface CustomTypes {
        Editor: BaseEditor & ReactEditor;
        Element: CustomElement;
        Text: CustomText;
    }
}

type SaveState = "idle" | "saving" | "saved" | "error";

export interface MinutesEditorProps {
    aiGeneratedMom?: string | Descendant[];
    onAutoSave?: (content: Descendant[]) => Promise<void> | void;
    debounceMs?: number;
    className?: string;
}

const defaultValue: Descendant[] = [
    {
        type: "paragraph",
        children: [{ text: "Start editing your meeting minutes here..." }],
    },
];

const LIST_TYPES: CustomElement["type"][] = ["numbered-list", "bulleted-list"];

const hasElementType = (node: unknown): node is SlateElement & { type: CustomElement["type"] } => {
    return SlateElement.isElement(node) && "type" in node;
};

const isMarkActive = (editor: Editor, format: "bold" | "italic") => {
    const marks = Editor.marks(editor);
    return marks ? marks[format] === true : false;
};

const toggleMark = (editor: Editor, format: "bold" | "italic") => {
    const isActive = isMarkActive(editor, format);
    if (isActive) {
        Editor.removeMark(editor, format);
    } else {
        Editor.addMark(editor, format, true);
    }
};

const isBlockActive = (editor: Editor, format: CustomElement["type"]) => {
    const [match] = Editor.nodes(editor, {
        match: (node) => !Editor.isEditor(node) && hasElementType(node) && node.type === format,
    });
    return !!match;
};

const toggleBlock = (editor: Editor, format: CustomElement["type"]) => {
    const isActive = isBlockActive(editor, format);
    const isList = LIST_TYPES.includes(format);

    Transforms.unwrapNodes(editor, {
        match: (node) =>
            !Editor.isEditor(node) && hasElementType(node) && LIST_TYPES.includes(node.type),
        split: true,
    });

    const nextType: CustomElement["type"] = isActive
        ? "paragraph"
        : isList
            ? "list-item"
            : format;

    Transforms.setNodes<SlateElement>(editor, { type: nextType });

    if (!isActive && isList) {
        const block = { type: format, children: [] } as CustomElement;
        Transforms.wrapNodes(editor, block);
    }
};

const toSlateValue = (input?: string | Descendant[]): Descendant[] => {
    if (!input) {
        return defaultValue;
    }

    if (Array.isArray(input)) {
        return input;
    }

    const lines = input
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    if (!lines.length) {
        return defaultValue;
    }

    return lines.map((line, index) => {
        if (index === 0) {
            return { type: "heading-one", children: [{ text: line }] } satisfies Descendant;
        }
        return { type: "paragraph", children: [{ text: line }] } satisfies Descendant;
    });
};

const extractPlainText = (value: Descendant[]): string => {
    return value.map((node) => Node.string(node)).join("\n").trim();
};

const saveBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
};

const ToolbarButton: FC<{
    isActive?: boolean;
    onClick: () => void;
    title: string;
    children: ReactNode;
}> = ({ isActive = false, onClick, title, children }) => (
    <button
        type="button"
        onMouseDown={(event) => {
            event.preventDefault();
            onClick();
        }}
        title={title}
        className={`rounded-md border px-2.5 py-1.5 transition-colors ${isActive
            ? "border-blue-500 bg-blue-50 text-blue-700"
            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
    >
        {children}
    </button>
);

const MarkButton: FC<{ format: "bold" | "italic"; icon: ReactNode; title: string }> = ({
    format,
    icon,
    title,
}) => {
    const editor = useSlate();
    return (
        <ToolbarButton
            title={title}
            isActive={isMarkActive(editor, format)}
            onClick={() => toggleMark(editor, format)}
        >
            {icon}
        </ToolbarButton>
    );
};

const BlockButton: FC<{ format: CustomElement["type"]; icon: ReactNode; title: string }> = ({
    format,
    icon,
    title,
}) => {
    const editor = useSlate();
    return (
        <ToolbarButton
            title={title}
            isActive={isBlockActive(editor, format)}
            onClick={() => toggleBlock(editor, format)}
        >
            {icon}
        </ToolbarButton>
    );
};

const Element = ({ attributes, children, element }: { attributes: any; children: ReactNode; element: CustomElement }) => {
    switch (element.type) {
        case "heading-one":
            return (
                <h1 {...attributes} className="mb-2 text-2xl font-bold text-slate-900">
                    {children}
                </h1>
            );
        case "heading-two":
            return (
                <h2 {...attributes} className="mb-2 text-xl font-semibold text-slate-800">
                    {children}
                </h2>
            );
        case "bulleted-list":
            return (
                <ul {...attributes} className="mb-2 list-disc pl-6">
                    {children}
                </ul>
            );
        case "numbered-list":
            return (
                <ol {...attributes} className="mb-2 list-decimal pl-6">
                    {children}
                </ol>
            );
        case "list-item":
            return <li {...attributes}>{children}</li>;
        default:
            return (
                <p {...attributes} className="mb-2 text-sm leading-6 text-slate-700">
                    {children}
                </p>
            );
    }
};

const Leaf = ({ attributes, children, leaf }: { attributes: any; children: ReactNode; leaf: CustomText }) => {
    let rendered = children;
    if (leaf.bold) {
        rendered = <strong>{rendered}</strong>;
    }
    if (leaf.italic) {
        rendered = <em>{rendered}</em>;
    }
    return <span {...attributes}>{rendered}</span>;
};

const MinutesEditor: FC<MinutesEditorProps> = ({
    aiGeneratedMom,
    onAutoSave,
    debounceMs = 1200,
    className,
}) => {
    const editor = useMemo(() => withReact(createEditor()), []);
    const [value, setValue] = useState<Descendant[]>(toSlateValue(aiGeneratedMom));
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [saveError, setSaveError] = useState<string | null>(null);
    const isApplyingExternalContent = useRef(false);

    const renderElement = useCallback((props: any) => <Element {...props} />, []);
    const renderLeaf = useCallback((props: any) => <Leaf {...props} />, []);

    useEffect(() => {
        if (typeof aiGeneratedMom === "undefined") {
            return;
        }

        isApplyingExternalContent.current = true;
        setValue(toSlateValue(aiGeneratedMom));
        setSaveState("saved");
        setSaveError(null);
    }, [aiGeneratedMom]);

    useEffect(() => {
        if (!onAutoSave) {
            return;
        }

        if (isApplyingExternalContent.current) {
            isApplyingExternalContent.current = false;
            return;
        }

        setSaveState("saving");
        setSaveError(null);

        const timeout = window.setTimeout(async () => {
            try {
                await onAutoSave(value);
                setSaveState("saved");
            } catch (error) {
                setSaveState("error");
                setSaveError(error instanceof Error ? error.message : "Auto-save failed");
            }
        }, debounceMs);

        return () => window.clearTimeout(timeout);
    }, [value, debounceMs, onAutoSave]);

    const handleExportPdf = () => {
        const pdf = new jsPDF({ unit: "pt", format: "a4" });
        const text = extractPlainText(value) || "Meeting Minutes";
        const lines = pdf.splitTextToSize(text, 520);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(12);
        pdf.text(lines, 40, 56);
        pdf.save(`meeting-minutes-${Date.now()}.pdf`);
    };

    const handleExportDocx = async () => {
        const paragraphs = value.map((node) => {
            if (!SlateElement.isElement(node)) {
                return new Paragraph({ children: [new TextRun(Node.string(node))] });
            }

            const text = Node.string(node);

            if (node.type === "heading-one") {
                return new Paragraph({ text, heading: HeadingLevel.HEADING_1 });
            }

            if (node.type === "heading-two") {
                return new Paragraph({ text, heading: HeadingLevel.HEADING_2 });
            }

            if (node.type === "list-item") {
                return new Paragraph({ text, bullet: { level: 0 } });
            }

            return new Paragraph({ children: [new TextRun(text)] });
        });

        const document = new Document({
            sections: [{ properties: {}, children: paragraphs }],
        });

        const blob = await Packer.toBlob(document);
        saveBlob(blob, `meeting-minutes-${Date.now()}.docx`);
    };

    const saveStatusText =
        saveState === "saving"
            ? "Saving..."
            : saveState === "saved"
                ? "All changes saved"
                : saveState === "error"
                    ? "Save failed"
                    : "Not saved yet";

    return (
        <Slate editor={editor} initialValue={value} onChange={setValue}>
            <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className ?? ""}`}>
                <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex flex-wrap gap-2">
                            <MarkButton format="bold" title="Bold" icon={<Bold size={16} />} />
                            <MarkButton format="italic" title="Italic" icon={<Italic size={16} />} />
                            <BlockButton format="heading-one" title="Heading 1" icon={<Heading1 size={16} />} />
                            <BlockButton format="heading-two" title="Heading 2" icon={<Heading2 size={16} />} />
                            <BlockButton format="bulleted-list" title="Bulleted List" icon={<List size={16} />} />
                            <BlockButton format="numbered-list" title="Numbered List" icon={<ListOrdered size={16} />} />
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={handleExportPdf}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                            <FileDown size={14} /> Export PDF
                        </button>
                        <button
                            type="button"
                            onClick={handleExportDocx}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                            <FileDown size={14} /> Export DOCX
                        </button>
                    </div>
                </div>

                <div className="min-h-[340px] p-4">
                    <Editable
                        renderElement={renderElement}
                        renderLeaf={renderLeaf}
                        placeholder="Edit meeting minutes..."
                        className="min-h-[300px] rounded-lg border border-slate-200 p-4 text-sm outline-none focus:border-blue-500"
                        spellCheck
                        autoFocus
                    />
                </div>

                <div className="flex flex-col gap-1 border-t border-slate-200 px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
                    <div
                        className={`inline-flex items-center gap-1.5 ${saveState === "error" ? "text-red-600" : "text-slate-500"
                            }`}
                    >
                        {saveState === "error" ? <AlertTriangle size={14} /> : <Save size={14} />}
                        <span>{saveStatusText}</span>
                    </div>
                    {saveError && <p className="text-red-600">{saveError}</p>}
                </div>
            </section>
        </Slate>
    );
};

export default MinutesEditor;
