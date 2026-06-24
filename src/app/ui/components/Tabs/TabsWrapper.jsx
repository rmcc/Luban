// import { Checkbox } from 'antd';
import React, { PureComponent } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import { Tabs } from 'antd';

import styles from './styles.styl';

class TabsWrapper extends PureComponent {
    static propTypes = {
        className: PropTypes.string,
        activeKey: PropTypes.string.isRequired,
        options: PropTypes.array.isRequired
    };

    render() {
        const { className = '', options, activeKey, ...rest } = this.props;

        // Map your options array into the format Ant Design's items property expects
        const tabItems = options.map((option) => ({
            key: option.key,
            label: option.tab,
            // If your options object has an inner component content or children, pass it here:
            // children: option.content
        }));

        return (
            <div className={classNames(className)}>
                <Tabs
                    {...rest}
                    activeKey={activeKey}
                    className={classNames(styles.tabs)}
                    items={tabItems}
                />
            </div>
        );
    }
}

export default TabsWrapper;
