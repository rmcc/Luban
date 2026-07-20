// import trimEnd from 'lodash/trimEnd';
import PerfectScrollbar from 'perfect-scrollbar';
import 'perfect-scrollbar/css/perfect-scrollbar.css';
import PropTypes from 'prop-types';
import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import log from '../../../lib/log';
import styles from './index.styl';

// .widget-header-absolute widget-content-absolute
const prompt = '> ';
let verticalScrollbar = null;

// Map standard ANSI foreground codes to CSS colors matching the old xterm style
const ansiColorMap = {
    '30': 'black',
    '31': 'red',
    '32': 'green',
    '33': 'yellow',
    '34': '#3b82f6', // bright blue
    '35': 'magenta',
    '36': '#06b6d4', // cyan
    '37': 'white',
    '90': 'gray'
};

const parseAnsiToReact = (text) => {
    const ansiRegex = /\[([0-9;]+)m/;
    const parts = [];
    let currentText = text;
    let currentStyle = {};
    let keyCounter = 0;

    while (currentText) {
        const match = currentText.match(ansiRegex);
        if (!match) {
            parts.push(<span key={keyCounter++} style={{ ...currentStyle }}>{currentText}</span>);
            break;
        }

        const index = match.index;
        if (index > 0) {
            parts.push(<span key={keyCounter++} style={{ ...currentStyle }}>{currentText.substring(0, index)}</span>);
        }

        const codes = match[1].split(';');
        codes.forEach(code => {
            if (code === '0' || code === '39') {
                currentStyle = {};
            } else if (ansiColorMap[code]) {
                currentStyle = { color: ansiColorMap[code] };
            }
        });

        currentText = currentText.substring(index + match[0].length);
    }

    return parts;
};

const TerminalWrapper = forwardRef(({ inputValue: inputValueProp, terminalHistory, onData, consoleHistory, isDefault }, ref) => {
    const [inputValue, setInputValue] = useState(inputValueProp);
    const [inputHeight, setInputHeight] = useState(20);
    const [lines, setLines] = useState([]);
    const terminalContainer = useRef();
    const input = useRef();
    const actions = {
        changeInputValue: (event) => {
            setInputValue(event.target.value);
            terminalHistory.set(0, event.target.value);
        }
    };

    function writeln(data, isHistory = true) {
        // Strip out control code structural blocks but leave color tags intact
        // eslint-disable-next-line no-control-regex
        const controlRegex = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
        const cleanData = String(data).replace(controlRegex, '');

        setLines(prev => {
            const next = [...prev, { id: Math.random().toString(36).substring(2, 9), text: cleanData }];
            if (next.length > 1000) {
                next.shift();
            }
            return next;
        });
        if (isHistory) {
            terminalHistory.push(data);
        }
        setTimeout(() => {
            if (terminalContainer.current) {
                terminalContainer.current.scrollTop = terminalContainer.current.scrollHeight;
                if (verticalScrollbar) {
                    verticalScrollbar.update();
                }
            }
        }, 10);
    }

    const eventHandler = {
        onResize: () => {
            log.debug('Resizing the terminal plain view');

            if (verticalScrollbar) {
                verticalScrollbar.update();
            }
        },
        onPaste: (data) => {
            if (document.activeElement === input) {
                const newLines = String(data).replace(/(\r\n|\r|\n)/g, '\n').split('\n');
                for (let i = 0; i < newLines.length; ++i) {
                    const line = newLines[i];
                    onData(line);
                    writeln(line);
                }
            }
        },
        onFocus: () => {
            input.current.focus();
        }
    };

    useEffect(() => {
        const el = terminalContainer.current;
        verticalScrollbar = new PerfectScrollbar(el);

        window.addEventListener('resize', eventHandler.onResize);

        return () => {
            window.removeEventListener('resize', eventHandler.onResize);
            if (verticalScrollbar) {
                verticalScrollbar.destroy();
                verticalScrollbar = null;
            }
        };
    }, []);

    function setTerminalInput(event) {
        // Enter
        if (event.keyCode === 13) {
            writeln(`${prompt}${event.target.value}`);
            onData(event.target.value);
            // Reset the index to the last position of the location array
            consoleHistory.push(event.target.value);
            event.target.value = '';
            setInputValue(event.target.value);
            terminalHistory.set(0, event.target.value);
        }

        // Arrow Up
        if (event.keyCode === 38) {
            event.target.value = consoleHistory.back() || '';
            terminalHistory.set(0, event.target.value);
        }

        // Arrow Down
        if (event.keyCode === 40) {
            event.target.value = consoleHistory.forward() || '';
            terminalHistory.set(0, event.target.value);
        }
    }

    function resize() {
        const height = terminalContainer.current.parentElement.clientHeight < 300
            ? 300 : terminalContainer.current.parentElement.clientHeight;
        const _inputHeight = height - (terminalContainer.current.clientHeight || 200) - 1;
        setInputHeight(_inputHeight);
        if (verticalScrollbar) {
            verticalScrollbar.update();
        }
    }

    function clear(isHistory = true) {
        setLines([]);
        if (isHistory) {
            terminalHistory.clear();
            terminalHistory.push('');
        }
    }

    function selectAll() {
        if (window.getSelection && terminalContainer.current) {
            const range = document.createRange();
            range.selectNodeContents(terminalContainer.current);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    function clearSelection() {
        if (window.getSelection) {
            window.getSelection().removeAllRanges();
        }
    }

    function write(data) {
        writeln(data, false);
    }

    useImperativeHandle(ref, () => ({
        writeln,
        setTerminalInput,
        resize,
        clear,
        selectAll,
        clearSelection,
        write
    }));

    const command = terminalHistory.getLength() > 0 ? terminalHistory.get(0) : inputValue;

    return (
        <div
            className={`${isDefault ? styles['terminal-content-absolute'] : styles['terminal-content']} dont-invert`}
        >
            <div
                ref={terminalContainer}
                style={{
                    height: '250px',
                    overflow: 'hidden',
                    position: 'relative',
                    fontFamily: 'Consolas, Menlo, Monaco, Lucida Console, Liberation Mono, DejaVu Sans Mono, Bitstream Vera Sans Mono, Courier New, monospace, serif',
                    paddingLeft: '3px',
                    backgroundColor: '#000000',
                    color: '#FFFFFF',
                    whiteSpace: 'pre-wrap',
                    userSelect: 'text'
                }}
            >
                {lines.map((line) => (
                    <div key={line.id}>{parseAnsiToReact(line.text)}</div>
                ))}
            </div>
            <div style={{
                height: '1px',
                backgroundColor: '#676869'
            }}
            />
            <input
                ref={input}
                style={{
                    width: '100%',
                    height: `${inputHeight}px`,
                    backgroundColor: '#000000',
                    color: '#FFFFFF',
                    border: 'none'
                }}
                type="text"
                placeholder="Send Command"
                value={command}
                onChange={actions.changeInputValue}
                onKeyDown={(event) => {
                    setTerminalInput(event);
                }}
            />
        </div>
    );
});

TerminalWrapper.propTypes = {
    onData: PropTypes.func,
    isDefault: PropTypes.bool,
    terminalHistory: PropTypes.object.isRequired,
    consoleHistory: PropTypes.object.isRequired,
    inputValue: PropTypes.string.isRequired
};
export default TerminalWrapper;
