import Toastify from "toastify-js";

export const toast = (text) => {
    Toastify({
        text: text,
        duration: 2000,
        gravity: "bottom",
        position: "right",
    }).showToast();
}

export const toClipboard = (text) => {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);

    toast("Copied to clipboard!");
}

export const isValidURL = (string) => {
    let url;
    try {
        url = new URL(string);
    } catch (_) {
        return false;
    }
    return url.protocol === "http:" || url.protocol === "https:";
}
