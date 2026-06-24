import React from 'react';

import i18n from '../../../lib/i18n';
import Card from '../../components/Card';

import ObjectListView from './ObjectListView';


const ObjectListCardView: React.FC = () => {
    return (
        <Card
            title={i18n._('key-Printing/ObjectList-Object List')}
            hasToggleButton
        >
            <ObjectListView />
        </Card>
    );
};

export default ObjectListCardView;
